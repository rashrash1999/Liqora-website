import { createHash, randomBytes, createHmac } from 'node:crypto';
import {
  DomainError,
  demand,
  normalizeOrder,
  normalizeGuests,
  normalizeRsvp,
  assertReady,
  reminderTimestamp,
  textValue,
} from './lib/domain.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value);
export function createService({ db, clock = () => Date.now(), ticketKey, qrCode, verifyFile }) {
  const orderRef = (id) => {
    demand(validId(id), 'معرف الطلب غير صحيح.');
    return db.doc(`orders/${id}`);
  };
  const uid = (request) => {
    demand(request.auth?.uid, 'سجل الدخول أولًا.', 'unauthenticated');
    return request.auth.uid;
  };
  const admin = (request) => {
    uid(request);
    demand(request.auth.token?.admin === true, 'هذه العملية للإدارة فقط.', 'permission-denied');
  };
  const owned = (request, order) =>
    demand(order.ownerUid === uid(request), 'ليس لديك صلاحية لهذا الطلب.', 'permission-denied');
  const exists = (snapshot) => {
    demand(snapshot.exists, 'البيانات غير موجودة.', 'not-found');
    return snapshot.data();
  };
  const requestId = (value) => {
    demand(validId(value), 'معرف العملية غير صحيح.');
    return value;
  };
  const audit = (tx, request, action, id, details = {}) =>
    tx.create(db.collection('auditLogs').doc(), {
      actorUid: request.auth?.uid || null,
      action,
      orderId: id,
      at: clock(),
      ...details,
    });
  async function rateLimit(request, action, max = 60) {
    const at = clock(),
      windowMs = 600000,
      identity = request.auth?.uid || request.rawRequest?.ip || 'unknown';
    const ref = db.doc(`rateLimits/${hash(`${action}:${identity}:${Math.floor(at / windowMs)}`)}`);
    await db.runTransaction(async (tx) => {
      const old = await tx.get(ref),
        count = old.exists ? old.data().count : 0;
      demand(count < max, 'محاولات كثيرة؛ انتظر قليلًا.', 'resource-exhausted');
      tx.set(ref, { count: count + 1, expiresAt: new Date(at + 2 * windowMs) });
    });
  }
  async function invitation(tx, token) {
    demand(
      typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token),
      'الدعوة غير صالحة.',
      'not-found',
    );
    const tokenRef = db.doc(`inviteTokens/${hash(token)}`),
      inv = exists(await tx.get(tokenRef));
    demand(inv.expiresAt > clock(), 'انتهت صلاحية الدعوة.', 'failed-precondition');
    const ref = orderRef(inv.orderId),
      guestRef = ref.collection('guests').doc(inv.guestId);
    const [os, gs] = await tx.getAll(ref, guestRef);
    const order = exists(os),
      guest = exists(gs);
    demand(
      order.status === 'active' && guest.inviteHash === hash(token),
      'الدعوة غير متاحة.',
      'failed-precondition',
    );
    demand(
      order.paymentStatus === 'paid' && order.designStatus === 'approved',
      'الدعوة غير متاحة.',
      'failed-precondition',
    );
    return { inv, ref, guestRef, order, guest };
  }
  function ticketFor(token, orderId, guestId) {
    const key = ticketKey();
    demand(
      typeof key === 'string' && key.length >= 32,
      'خدمة البطاقات غير مهيأة.',
      'failed-precondition',
    );
    return createHmac('sha256', key)
      .update(`ticket:v1:${orderId}:${guestId}:${token}`)
      .digest('base64url');
  }
  async function publicInvitation(token) {
    const data = await db.runTransaction((tx) => invitation(tx, token));
    const { order, guest, inv } = data;
    const result = {
      event: {
        honorees: order.honorees,
        occasion: order.occasion,
        eventDate: order.eventDate,
        eventTime: order.eventTime,
        eventAt: order.eventAt,
        venueName: order.venueName,
        city: order.city,
        mapUrl: order.mapUrl,
        childPolicy: order.childPolicy,
        invitationMessage: order.invitationMessage,
      },
      guest: { displayName: guest.displayName, companionsLimit: guest.companionsLimit },
      response:
        guest.rsvpState === 'pending'
          ? null
          : {
              attendance: guest.rsvpState,
              guestName: guest.responseName,
              companions: guest.companions,
            },
      ticket: null,
    };
    if (guest.rsvpState === 'yes') {
      const ticket = ticketFor(token, inv.orderId, inv.guestId);
      demand(
        guest.ticketHash === hash(ticket),
        'يرجى التواصل مع الإدارة لاستعادة البطاقة.',
        'failed-precondition',
      );
      const payload = `MEDAD1:${ticket}`;
      result.ticket = { payload, qrDataUrl: await qrCode(payload), checkedIn: !!guest.checkedInAt };
    }
    return result;
  }
  async function staffTicket(tx, request, input) {
    uid(request);
    demand(
      request.auth.token.admin === true || request.auth.token.gate === true,
      'صلاحية الاستقبال مطلوبة.',
      'permission-denied',
    );
    const ref = orderRef(input.orderId);
    const token = String(input.token || '').replace(/^MEDAD1:/, '');
    demand(/^[A-Za-z0-9_-]{43}$/.test(token), 'البطاقة غير صالحة.');
    const ticket = exists(await tx.get(db.doc(`ticketTokens/${hash(token)}`)));
    demand(ticket.orderId === input.orderId, 'البطاقة لا تخص هذه المناسبة.', 'permission-denied');
    if (request.auth.token.admin !== true) {
      const assignment = await tx.get(
        db.doc(`gateAssignments/${request.auth.uid}/orders/${input.orderId}`),
      );
      demand(
        assignment.exists && assignment.data().active === true,
        'غير مصرح لك باستقبال هذه المناسبة.',
        'permission-denied',
      );
    }
    const guestRef = ref.collection('guests').doc(ticket.guestId);
    const [os, gs] = await tx.getAll(ref, guestRef);
    const order = exists(os),
      guest = exists(gs);
    demand(
      order.status === 'active' &&
        order.paymentStatus === 'paid' &&
        guest.rsvpState === 'yes' &&
        guest.ticketHash === hash(token),
      'البطاقة غير فعالة.',
      'failed-precondition',
    );
    demand(
      clock() >= order.eventAt - 4 * 3600000 && clock() <= ticket.expiresAt,
      'البوابة متاحة من أربع ساعات قبل المناسبة إلى ست ساعات بعدها.',
      'failed-precondition',
    );
    return { ref, guestRef, order, guest };
  }
  const handlers = {
    async createOrder(request) {
      const ownerUid = uid(request);
      const input = request.data || {};
      const key = requestId(input.requestId);
      const order = normalizeOrder(input.order, request.auth.token?.phone_number, clock());
      const contentHash = hash(JSON.stringify(order));
      const id = hash(`${ownerUid}:${key}`).slice(0, 28),
        ref = orderRef(id);
      return db.runTransaction(async (tx) => {
        const old = await tx.get(ref);
        if (old.exists) {
          demand(
            old.data().contentHash === contentHash,
            'استُخدم معرف العملية لطلب مختلف.',
            'already-exists',
          );
          return { id, replayed: true };
        }
        tx.create(ref, {
          ...order,
          id,
          ownerUid,
          contentHash,
          createdAt: clock(),
          updatedAt: clock(),
          status: order.quoteRequired ? 'awaiting_quote' : 'pending_payment',
          paymentStatus: 'unpaid',
          designStatus: 'none',
          designVersion: null,
          approvedDesignVersion: null,
          guestCount: 0,
          acceptedCount: 0,
          declinedCount: 0,
          checkedInCount: 0,
          reminderStatus: 'not_requested',
        });
        audit(tx, request, 'order.created', id);
        return { id, replayed: false };
      });
    },
    async saveReminderPreference(request) {
      const ref = orderRef(request.data?.orderId);
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        owned(request, order);
        demand(
          !['cancelled', 'completed'].includes(order.status),
          'لا يمكن تعديل طلب ملغي أو منتهٍ.',
          'failed-precondition',
        );
        const at = reminderTimestamp(order, request.data.hours, clock());
        tx.update(ref, {
          reminderHours: request.data.hours,
          requestedReminderAt: at,
          reminderStatus: 'requested',
          updatedAt: clock(),
        });
        audit(tx, request, 'reminder.requested', ref.id);
        return { status: 'requested' };
      });
    },
    async prepareUpload(request) {
      uid(request);
      const { orderId, kind, contentType, size } = request.data || {};
      const ref = orderRef(orderId);
      demand(kind === 'reference' || kind === 'design', 'نوع الملف غير صحيح.');
      const allowed =
        kind === 'design'
          ? ['image/png', 'image/jpeg', 'image/webp']
          : ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
      demand(
        allowed.includes(contentType) &&
          Number.isSafeInteger(size) &&
          size > 0 &&
          size <= 10 * 1024 * 1024,
        'نوع الملف أو حجمه غير مسموح.',
      );
      const uploadId = randomToken(),
        path = `orders/${orderId}/${kind === 'design' ? 'design' : 'references'}/${uploadId}`;
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        if (kind === 'design') {
          admin(request);
          demand(order.paymentStatus === 'paid', 'أكمل الدفع أولًا.', 'failed-precondition');
        } else owned(request, order);
        demand(
          !['active', 'cancelled', 'completed'].includes(order.status) && order.eventAt > clock(),
          'لا يمكن تغيير الملفات بعد تفعيل الدعوات أو إلغاء الطلب أو انتهاء المناسبة.',
          'failed-precondition',
        );
        const slots = { ...(order.uploadSlots || {}) };
        const prefix = kind === 'reference' ? 'reference' : 'design';
        let slot = -1;
        for (let i = 0; i < (kind === 'reference' ? 3 : 1); i++) {
          const old = slots[`${prefix}${i}`];
          if (
            !old ||
            (old.expiresAt < clock() && !old.completed) ||
            (kind === 'design' && old.completed)
          ) {
            slot = i;
            break;
          }
        }
        demand(
          slot !== -1,
          'بلغت حد الملفات أو يوجد رفع قيد التنفيذ. انتظر عشر دقائق قبل إعادة المحاولة.',
          'resource-exhausted',
        );
        const key = `${prefix}${slot}`;
        slots[key] = { uploadId, expiresAt: clock() + 600000, completed: false };
        tx.update(ref, { uploadSlots: slots });
        tx.create(db.doc(`uploads/${uploadId}`), {
          path,
          orderId,
          ownerUid: request.auth.uid,
          kind,
          contentType,
          size,
          slot: key,
          expiresAt: clock() + 600000,
          status: 'pending',
        });
        return { path };
      });
    },
    async registerUpload(request) {
      uid(request);
      const { orderId, path, kind } = request.data || {};
      const ref = orderRef(orderId);
      demand(kind === 'reference' || kind === 'design', 'نوع الملف غير صحيح.');
      const before = exists(await ref.get());
      if (kind === 'design') admin(request);
      else owned(request, before);
      demand(
        typeof path === 'string' &&
          new RegExp(
            `^orders/${orderId}/${kind === 'design' ? 'design' : 'references'}/[a-zA-Z0-9_-]{43}$`,
          ).test(path),
        'مسار الملف غير صحيح.',
      );
      const uploadRef = db.doc(`uploads/${path.split('/').pop()}`),
        upload = exists(await uploadRef.get());
      demand(
        upload.ownerUid === request.auth.uid && upload.path === path && upload.kind === kind,
        'الملف لا يخص هذه العملية.',
        'permission-denied',
      );
      await verifyFile(path, kind);
      return db.runTransaction(async (tx) => {
        const [os, us] = await tx.getAll(ref, uploadRef);
        const order = exists(os),
          currentUpload = exists(us);
        if (kind === 'reference') owned(request, order);
        demand(
          order.uploadSlots?.[upload.slot]?.uploadId === uploadRef.id,
          'انتهى حجز رفع الملف.',
          'failed-precondition',
        );
        if (currentUpload.status === 'complete') return { saved: true };
        demand(
          !['active', 'cancelled', 'completed'].includes(order.status) && order.eventAt > clock(),
          'لا يمكن تغيير الملفات بعد تفعيل الدعوات أو إلغاء الطلب أو انتهاء المناسبة.',
          'failed-precondition',
        );
        if (kind === 'design') {
          demand(order.paymentStatus === 'paid', 'يجب تأكيد الدفع أولًا.', 'failed-precondition');
          tx.update(ref, {
            designPath: path,
            designVersion: hash(path),
            designStatus: 'awaiting_approval',
            approvedDesignVersion: null,
            status: 'preparing',
            updatedAt: clock(),
          });
        } else {
          const paths = new Set(order.referencePaths || []);
          paths.add(path);
          demand(paths.size <= 3, 'الحد الأعلى ثلاثة ملفات مرجعية.');
          tx.update(ref, { referencePaths: [...paths], updatedAt: clock() });
        }
        tx.update(uploadRef, { status: 'complete' });
        tx.update(ref, { [`uploadSlots.${upload.slot}.completed`]: true });
        audit(tx, request, `${kind}.uploaded`, orderId);
        return { saved: true };
      });
    },
    async approveDesign(request) {
      const ref = orderRef(request.data?.orderId);
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        owned(request, order);
        demand(
          !['active', 'cancelled', 'completed'].includes(order.status) && order.eventAt > clock(),
          'لا يمكن اعتماد تصميم لطلب مفعل أو ملغي أو منتهٍ.',
          'failed-precondition',
        );
        if (
          order.designStatus === 'approved' &&
          order.approvedDesignVersion === request.data.version
        )
          return { approved: true, replayed: true };
        demand(
          order.designStatus === 'awaiting_approval' &&
            order.designPath &&
            order.designVersion === request.data.version,
          'تغير التصميم؛ افتح النسخة الجديدة قبل الاعتماد.',
          'failed-precondition',
        );
        demand(order.paymentStatus === 'paid', 'الدفع لم يؤكد بعد.', 'failed-precondition');
        tx.update(ref, {
          designStatus: 'approved',
          approvedDesignVersion: order.designVersion,
          approvedAt: clock(),
          updatedAt: clock(),
        });
        audit(tx, request, 'design.approved', ref.id);
        return { approved: true };
      });
    },
    async importGuests(request) {
      admin(request);
      const ref = orderRef(request.data?.orderId);
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        demand(order.paymentStatus === 'paid', 'أكمل الدفع قبل رفع الضيوف.', 'failed-precondition');
        demand(
          !['active', 'cancelled', 'completed'].includes(order.status) && order.eventAt > clock(),
          'لا يمكن تعديل القائمة بعد تفعيل الدعوات أو إلغاء الطلب أو انتهاء المناسبة.',
          'failed-precondition',
        );
        const rows = normalizeGuests(request.data.rows, order);
        const refs = rows.map((row) =>
          ref.collection('guests').doc(hash(`${ref.id}:${row.phone}`).slice(0, 28)),
        );
        const snapshots = await tx.getAll(...refs);
        const added = snapshots.filter((s) => !s.exists).length;
        demand(
          order.guestCount + added <= order.expectedGuests,
          'القائمة تتجاوز عدد المدعوين المعتمد للطلب.',
        );
        rows.forEach((row, i) => {
          if (snapshots[i].exists) return;
          const { phone, ...guest } = row;
          tx.create(refs[i], {
            ...guest,
            id: refs[i].id,
            orderId: ref.id,
            ownerUid: order.ownerUid,
            phoneMasked: `${phone.slice(0, 4)}•••••${phone.slice(-4)}`,
            rsvpState: 'pending',
            companions: 0,
            checkedInAt: null,
            createdAt: clock(),
          });
          tx.create(ref.collection('guestContacts').doc(refs[i].id), { phone });
        });
        if (added) {
          tx.update(ref, { guestCount: order.guestCount + added, updatedAt: clock() });
          audit(tx, request, 'guests.imported', ref.id, { count: added });
        }
        return { added, skipped: rows.length - added };
      });
    },
    async issueInvitations(request) {
      admin(request);
      const ref = orderRef(request.data?.orderId);
      const ids = request.data.guestIds;
      demand(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 100 &&
          ids.every(validId) &&
          new Set(ids).size === ids.length,
        'اختر من 1 إلى 100 ضيف مختلف.',
      );
      const tokens = ids.map(() => randomToken());
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        assertReady(order, clock());
        const refs = ids.map((id) => ref.collection('guests').doc(id)),
          snapshots = await tx.getAll(...refs);
        const contacts = await tx.getAll(
          ...ids.map((id) => ref.collection('guestContacts').doc(id)),
        );
        const guests = snapshots.map(exists);
        demand(
          guests.every((g) => g.rsvpState === 'pending'),
          'لا تجدّد روابط الضيوف الذين ردوا؛ بطاقاتهم الحالية تظل صالحة.',
          'failed-precondition',
        );
        guests.forEach((guest, i) => {
          if (guest.inviteHash) tx.delete(db.doc(`inviteTokens/${guest.inviteHash}`));
          const tokenHash = hash(tokens[i]);
          tx.create(db.doc(`inviteTokens/${tokenHash}`), {
            orderId: ref.id,
            guestId: ids[i],
            expiresAt: order.eventAt + 6 * 3600000,
          });
          tx.update(refs[i], { inviteHash: tokenHash, issuedAt: clock() });
        });
        tx.update(ref, { status: 'active', updatedAt: clock() });
        audit(tx, request, 'invitations.issued', ref.id, { count: ids.length });
        return {
          links: guests.map((guest, i) => ({
            id: ids[i],
            name: guest.displayName,
            phone: exists(contacts[i]).phone,
            token: tokens[i],
          })),
        };
      });
    },
    async getInvitation(request) {
      return publicInvitation(request.data?.token);
    },
    async submitRsvp(request) {
      const input = request.data || {};
      const rid = requestId(input.requestId);
      await db.runTransaction(async (tx) => {
        const { inv, ref, guestRef, order, guest } = await invitation(tx, input.token);
        demand(order.eventAt > clock(), 'انتهى موعد استقبال الردود.', 'failed-precondition');
        const response = normalizeRsvp(input, guest);
        const responseHash = hash(JSON.stringify(response));
        if (guest.rsvpState !== 'pending') {
          demand(
            guest.rsvpRequestId === rid && guest.responseHash === responseHash,
            'تم تسجيل رد لهذه الدعوة بالفعل.',
            'already-exists',
          );
          return;
        }
        const patch = {
          rsvpState: response.attendance,
          responseName: response.guestName,
          companions: response.companions,
          message: response.message,
          rsvpAt: clock(),
          rsvpRequestId: rid,
          responseHash,
        };
        if (response.attendance === 'yes') {
          const ticket = ticketFor(input.token, inv.orderId, inv.guestId);
          patch.ticketHash = hash(ticket);
          tx.create(db.doc(`ticketTokens/${patch.ticketHash}`), {
            orderId: inv.orderId,
            guestId: inv.guestId,
            expiresAt: order.eventAt + 6 * 3600000,
          });
        }
        tx.update(guestRef, patch);
        const counter = response.attendance === 'yes' ? 'acceptedCount' : 'declinedCount';
        tx.update(ref, { [counter]: (order[counter] || 0) + 1, updatedAt: clock() });
        audit(tx, request, 'rsvp.recorded', inv.orderId, { guestId: inv.guestId });
      });
      return publicInvitation(input.token);
    },
    async verifyTicket(request) {
      return db.runTransaction(async (tx) => {
        const { guest } = await staffTicket(tx, request, request.data || {});
        return {
          guestId: guest.id,
          displayName: guest.responseName,
          companions: guest.companions,
          checkedIn: !!guest.checkedInAt,
        };
      });
    },
    async checkInTicket(request) {
      requestId(request.data?.requestId);
      return db.runTransaction(async (tx) => {
        const { ref, guestRef, order, guest } = await staffTicket(tx, request, request.data || {});
        if (guest.checkedInAt) return { checkedIn: true, alreadyCheckedIn: true };
        tx.update(guestRef, { checkedInAt: clock(), checkedInBy: request.auth.uid });
        tx.update(ref, { checkedInCount: (order.checkedInCount || 0) + 1, updatedAt: clock() });
        audit(tx, request, 'guest.checked_in', ref.id, { guestId: guest.id });
        return { checkedIn: true, alreadyCheckedIn: false };
      });
    },
    async getGateAssignments(request) {
      uid(request);
      demand(
        request.auth.token.admin === true || request.auth.token.gate === true,
        'صلاحية الاستقبال مطلوبة.',
        'permission-denied',
      );
      if (request.auth.token.admin === true) {
        const snap = await db.collection('orders').where('status', '==', 'active').limit(100).get();
        return {
          orders: snap.docs.map((d) => ({
            id: d.id,
            honorees: d.data().honorees,
            eventAt: d.data().eventAt,
          })),
        };
      }
      const snap = await db
        .collection(`gateAssignments/${request.auth.uid}/orders`)
        .where('active', '==', true)
        .limit(100)
        .get();
      const orders = await Promise.all(
        snap.docs.map(async (d) => {
          const order = await orderRef(d.id).get();
          return order.exists && order.data().status === 'active'
            ? { id: d.id, honorees: order.data().honorees, eventAt: order.data().eventAt }
            : null;
        }),
      );
      return { orders: orders.filter(Boolean) };
    },
    async createPaymentSession(request) {
      const order = exists(await orderRef(request.data?.orderId).get());
      owned(request, order);
      throw new DomainError(
        'الدفع الإلكتروني لم يُفعّل بعد. طلبك محفوظ ولم يُخصم أي مبلغ.',
        'failed-precondition',
      );
    },
    async sendInvitations(request) {
      admin(request);
      throw new DomainError(
        'الإرسال الآلي غير مفعّل بعد. يمكنك إنشاء روابط الدعوات ومشاركتها يدويًا بعد استيفاء المتطلبات.',
        'failed-precondition',
      );
    },
    async scheduleReminders(request) {
      admin(request);
      throw new DomainError(
        'لم يُربط مزود الرسائل بعد؛ لم تتم جدولة أي رسالة.',
        'failed-precondition',
      );
    },
  };
  return { handlers, rateLimit };
}
