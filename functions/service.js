import { createHash, randomBytes, createHmac } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import {
  DomainError,
  demand,
  normalizeOrder,
  normalizeGuests,
  normalizeRsvp,
  normalizeSaudiPhone,
  normalizeReminderHours,
  assertReady,
  reminderTimestamp,
  textValue,
} from './lib/domain.js';
import {
  internalPaymentStatus,
  normalizePricingApproval,
  payablePricing,
} from './payment/domain.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value);
export function createService({
  db,
  clock = () => Date.now(),
  ticketKey,
  qrCode,
  verifyFile,
  paymentGateway,
  messagingProvider,
  privateAssetUrl,
  siteOrigin = () => 'https://medadtahaya.com',
}) {
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
  const gateway = () => {
    demand(
      paymentGateway &&
        typeof paymentGateway.createInvoice === 'function' &&
        typeof paymentGateway.fetchInvoice === 'function',
      'خدمة الدفع غير مهيأة بعد.',
      'failed-precondition',
    );
    return paymentGateway;
  };
  const messenger = () => {
    demand(
      messagingProvider && typeof messagingProvider.sendTemplate === 'function',
      'مزود WhatsApp Business غير مهيأ بعد.',
      'failed-precondition',
    );
    return messagingProvider;
  };
  const signedToken = (...parts) => {
    const key = ticketKey();
    demand(
      typeof key === 'string' && key.length >= 32,
      'خدمة الروابط الآمنة غير مهيأة.',
      'failed-precondition',
    );
    return createHmac('sha256', key).update(parts.join(':')).digest('base64url');
  };
  const publicTokenFor = (orderId) => signedToken('public', 'v1', orderId);
  const invitationTokenFor = (orderId, guestId, phone, version = 1) =>
    signedToken('invite', 'v2', orderId, guestId, phone, String(version));
  const attachApprovedDesign = async (view, order) => {
    if (!order.customDesign || !order.designPath) return view;
    demand(
      order.designStatus === 'approved' &&
        order.approvedDesignVersion === order.designVersion &&
        typeof privateAssetUrl === 'function',
      'التصميم المعتمد غير متاح حاليًا.',
      'failed-precondition',
    );
    view.event.designUrl = await privateAssetUrl(order.designPath);
    return view;
  };
  const futureReminderSchedule = (order) => {
    const hours = normalizeReminderHours(order.reminderHours);
    return hours
      .map((value) => ({
        hours: value,
        at: order.eventAt - value * 3600000,
        status: order.eventAt - value * 3600000 > clock() ? 'scheduled' : 'missed',
      }))
      .sort((a, b) => a.at - b.at);
  };
  const reminderFields = (order) => {
    const schedule = (
      Array.isArray(order.reminderSchedule) ? order.reminderSchedule : futureReminderSchedule(order)
    ).map((item) =>
      item.status === 'scheduled' && item.at <= clock() ? { ...item, status: 'missed' } : item,
    );
    const upcoming = schedule.filter((item) => item.status === 'scheduled' && item.at > clock());
    return {
      reminderSchedule: schedule,
      nextReminderAt: upcoming.length ? Math.min(...upcoming.map((item) => item.at)) : null,
      reminderStatus: upcoming.length ? 'scheduled' : 'completed',
    };
  };
  const capacityAlerts = (tx, ref, order, nextSeats) => {
    const capacity = order.seatCapacity || order.expectedGuests;
    const previous = order.acceptedSeats || 0;
    for (const threshold of [80, 90, 100]) {
      const point = Math.ceil((capacity * threshold) / 100);
      if (previous < point && nextSeats >= point)
        tx.set(ref.collection('notifications').doc(`capacity-${threshold}`), {
          type: 'capacity',
          threshold,
          acceptedSeats: nextSeats,
          seatCapacity: capacity,
          createdAt: clock(),
          readAt: null,
        });
    }
  };
  const gatewayFailure = (error) => {
    if (error instanceof DomainError) throw error;
    const configured = error?.code === 'failed-precondition';
    throw new DomainError(
      configured
        ? 'إعداد بوابة الدفع غير مكتمل. تواصل مع الإدارة.'
        : 'تعذر الاتصال ببوابة الدفع؛ لم يُخصم أي مبلغ. حاول لاحقًا.',
      configured ? 'failed-precondition' : 'unavailable',
    );
  };
  async function rateLimit(request, action, max = 60) {
    const at = clock(),
      windowMs = 600000,
      publicTokenActions = new Set(['getPublicEvent', 'getInvitation', 'submitRsvp']),
      tokenScope = publicTokenActions.has(action)
        ? hash(String(request.data?.token || '')).slice(0, 16)
        : '',
      identity =
        request.auth?.uid ||
        `${request.rawRequest?.ip || 'unknown'}${tokenScope ? `:${tokenScope}` : ''}`;
    const ref = db.doc(`rateLimits/${hash(`${action}:${identity}:${Math.floor(at / windowMs)}`)}`);
    await db.runTransaction(async (tx) => {
      const old = await tx.get(ref),
        count = old.exists ? old.data().count : 0;
      demand(count < max, 'محاولات كثيرة؛ انتظر قليلًا.', 'resource-exhausted');
      tx.set(ref, { count: count + 1, expiresAt: new Date(at + 2 * windowMs) });
    });
  }

  async function reconcilePayment(invoice, { source = 'webhook', actorUid = null } = {}) {
    demand(invoice && typeof invoice === 'object', 'بيانات فاتورة الدفع غير صحيحة.');
    const mappingRef = db.doc(`paymentInvoices/${invoice.id}`);
    return db.runTransaction(async (tx) => {
      const mapping = exists(await tx.get(mappingRef));
      const ref = orderRef(mapping.orderId);
      const attemptRef = ref.collection('paymentAttempts').doc(mapping.attemptId);
      const [orderSnap, attemptSnap] = await tx.getAll(ref, attemptRef);
      const order = exists(orderSnap);
      const attempt = exists(attemptSnap);
      demand(
        mapping.provider === 'moyasar' &&
          mapping.invoiceId === invoice.id &&
          mapping.amountHalalas === invoice.amount &&
          mapping.currency === invoice.currency &&
          attempt.invoiceId === invoice.id &&
          attempt.amountHalalas === invoice.amount &&
          attempt.currency === invoice.currency &&
          attempt.provider === 'moyasar' &&
          attempt.orderId === mapping.orderId,
        'بيانات الفاتورة لا تطابق الطلب.',
        'failed-precondition',
      );
      const status = internalPaymentStatus(invoice.status);
      const replayed =
        mapping.providerStatus === invoice.status &&
        (mapping.paymentId || null) === (invoice.paymentId || null) &&
        order.paymentStatus === status;
      if (replayed) return { paymentStatus: status, replayed: true };

      const checkedAt = clock();
      tx.update(mappingRef, {
        providerStatus: invoice.status,
        paymentId: invoice.paymentId || null,
        refundedAmountHalalas: invoice.refundedAmount || 0,
        providerUpdatedAt: invoice.providerUpdatedAt || null,
        checkedAt,
      });
      tx.update(attemptRef, {
        providerStatus: invoice.status,
        paymentStatus: status,
        paymentId: invoice.paymentId || null,
        checkedAt,
      });

      const current = order.paymentSession?.invoiceId === invoice.id;
      const request = { auth: actorUid ? { uid: actorUid } : null };
      if (status === 'paid') {
        if (order.paymentStatus === 'paid' && order.paidInvoiceId !== invoice.id) {
          tx.update(ref, {
            paymentReviewRequired: true,
            paymentReviewReason: 'duplicate_paid_invoice',
            updatedAt: checkedAt,
          });
          audit(tx, request, 'payment.duplicate_detected', ref.id, {
            invoiceId: invoice.id,
            source,
          });
          return { paymentStatus: 'paid', duplicate: true };
        }
        tx.update(ref, {
          paymentStatus: 'paid',
          paidAmountHalalas: invoice.amount,
          paidInvoiceId: invoice.id,
          paidPaymentId: invoice.paymentId,
          paidAt: checkedAt,
          paymentSession: {
            ...(order.paymentSession || {}),
            provider: 'moyasar',
            invoiceId: invoice.id,
            providerStatus: invoice.status,
            amountHalalas: invoice.amount,
            currency: invoice.currency,
            checkedAt,
          },
          status: ['awaiting_quote', 'pending_payment'].includes(order.status)
            ? 'paid'
            : order.status,
          updatedAt: checkedAt,
        });
      } else if (status === 'refunded' && (current || order.paidInvoiceId === invoice.id)) {
        tx.update(ref, {
          paymentStatus: 'refunded',
          refundedAmountHalalas: invoice.refundedAmount || invoice.amount,
          refundedAt: checkedAt,
          updatedAt: checkedAt,
        });
      } else if (current && order.paymentStatus !== 'paid') {
        tx.update(ref, {
          paymentStatus: status,
          paymentSession: {
            ...order.paymentSession,
            providerStatus: invoice.status,
            checkedAt,
          },
          updatedAt: checkedAt,
        });
      }
      audit(tx, request, `payment.${invoice.status}`, ref.id, {
        invoiceId: invoice.id,
        source,
      });
      return { paymentStatus: status, replayed: false };
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
        theme: order.theme,
        orientation: order.orientation,
        preferredColors: order.preferredColors,
        designTone: order.designTone,
        cardType: guest.cardType || 'general',
      },
      guest: {
        displayName: guest.displayName,
        companionsLimit: guest.companionsLimit,
        companionNamesRequired: guest.companionNamesRequired !== false,
      },
      response:
        guest.rsvpState === 'pending'
          ? null
          : {
              attendance: guest.rsvpState,
              guestName: guest.responseName,
              companions: guest.companions,
              companionNames: guest.companionNames || [],
              message: guest.message || '',
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
    return attachApprovedDesign(result, order);
  }
  async function publicEvent(tx, token) {
    demand(
      typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token),
      'رابط المناسبة غير صالح.',
      'not-found',
    );
    const mapping = exists(await tx.get(db.doc(`publicEventTokens/${hash(token)}`)));
    demand(mapping.expiresAt > clock(), 'انتهت صلاحية رابط المناسبة.', 'failed-precondition');
    const ref = orderRef(mapping.orderId);
    const order = exists(await tx.get(ref));
    demand(
      order.status === 'active' &&
        order.paymentStatus === 'paid' &&
        order.designStatus === 'approved' &&
        order.shareTokenHash === hash(token),
      'المناسبة غير متاحة حاليًا.',
      'failed-precondition',
    );
    return { ref, order };
  }
  function publicEventView(order) {
    const invitationLimit = order.invitationLimit || order.expectedGuests;
    const seatCapacity = order.seatCapacity || order.expectedGuests;
    const acceptedSeats = order.acceptedSeats || 0;
    return {
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
        theme: order.theme,
        orientation: order.orientation,
        preferredColors: order.preferredColors,
        designTone: order.designTone,
      },
      registration: {
        mode: order.registrationMode,
        open:
          order.registrationMode === 'open' &&
          (order.guestCount || 0) < invitationLimit &&
          (acceptedSeats < seatCapacity || order.allowWaitlist === true) &&
          order.eventAt > clock(),
        invitationLimit,
        registered: order.guestCount || 0,
        seatCapacity,
        acceptedSeats,
        remainingSeats: Math.max(0, seatCapacity - acceptedSeats),
        maxCompanions: order.maxCompanions || 0,
        companionNamesRequired: order.companionNamesRequired !== false,
        allowWaitlist: order.allowWaitlist === true,
      },
    };
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
        const templateVersion = `template:${order.theme}:v1`;
        const automaticPricing = order.quoteRequired
          ? null
          : {
              status: 'approved',
              currency: 'SAR',
              items: order.automaticPricing.items,
              subtotalHalalas: order.automaticPricing.subtotalHalalas,
              discountHalalas: 0,
              taxHalalas: 0,
              totalHalalas: order.automaticPricing.subtotalHalalas,
              expiresAt: order.eventAt,
              approvedAt: clock(),
              approvedBy: 'automatic-pricing-v1',
            };
        tx.create(ref, {
          ...order,
          id,
          ownerUid,
          contentHash,
          createdAt: clock(),
          updatedAt: clock(),
          status: order.quoteRequired ? 'awaiting_quote' : 'pending_payment',
          pricing: automaticPricing,
          paymentStatus: 'unpaid',
          designStatus: order.customDesign ? 'awaiting_design' : 'approved',
          designVersion: order.customDesign ? null : templateVersion,
          approvedDesignVersion: order.customDesign ? null : templateVersion,
          guestCount: 0,
          acceptedCount: 0,
          acceptedSeats: 0,
          declinedCount: 0,
          waitlistCount: 0,
          checkedInCount: 0,
          checkedInSeats: 0,
          messageCount: 0,
          shareTokenHash: null,
          reminderStatus: 'configured',
        });
        audit(tx, request, 'order.created', id);
        return { id, replayed: false };
      });
    },
    async approvePricing(request) {
      admin(request);
      const ref = orderRef(request.data?.orderId);
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        demand(
          order.eventAt > clock() && !['active', 'cancelled', 'completed'].includes(order.status),
          'لا يمكن تسعير طلب مفعل أو ملغي أو منتهٍ.',
          'failed-precondition',
        );
        demand(
          !['paid', 'pending', 'processing'].includes(order.paymentStatus),
          'لا يمكن تعديل السعر أثناء عملية دفع أو بعد تأكيدها.',
          'failed-precondition',
        );
        demand(
          !order.paymentCreateLock || order.paymentCreateLock.expiresAt <= clock(),
          'يجري إنشاء فاتورة دفع لهذا الطلب. انتظر قليلًا ثم حدّث الحالة.',
          'aborted',
        );
        const pricing = normalizePricingApproval(request.data, order, clock());
        tx.update(ref, {
          pricing: {
            ...pricing,
            approvedAt: clock(),
            approvedBy: request.auth.uid,
          },
          paymentStatus: 'unpaid',
          paymentSession: null,
          paymentCreateLock: null,
          status: 'pending_payment',
          updatedAt: clock(),
        });
        audit(tx, request, 'pricing.approved', ref.id, {
          totalHalalas: pricing.totalHalalas,
          expiresAt: pricing.expiresAt,
        });
        return { pricing };
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
        const hours = normalizeReminderHours(request.data.hours);
        const schedule = hours.map((value) => ({
          hours: value,
          at: reminderTimestamp(order, value, clock()),
          status: 'scheduled',
        }));
        const active = order.status === 'active';
        tx.update(ref, {
          reminderHours: hours,
          reminderSchedule: schedule,
          nextReminderAt: active ? Math.min(...schedule.map((item) => item.at)) : null,
          reminderStatus: active ? 'scheduled' : 'configured',
          updatedAt: clock(),
        });
        audit(tx, request, 'reminder.requested', ref.id);
        return { status: active ? 'scheduled' : 'configured', schedule };
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
          order.guestCount + added <= (order.invitationLimit || order.expectedGuests),
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
            companionNamesRequired: order.companionNamesRequired !== false,
            rsvpState: 'pending',
            companions: 0,
            companionNames: [],
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
        const tokens = guests.map((guest, i) => {
          const phone = exists(contacts[i]).phone;
          const version = (guest.inviteVersion || 0) + 1;
          const token = invitationTokenFor(ref.id, ids[i], phone, version);
          if (guest.inviteHash) tx.delete(db.doc(`inviteTokens/${guest.inviteHash}`));
          const tokenHash = hash(token);
          tx.create(db.doc(`inviteTokens/${tokenHash}`), {
            orderId: ref.id,
            guestId: ids[i],
            expiresAt: order.eventAt + 6 * 3600000,
          });
          tx.update(refs[i], { inviteHash: tokenHash, inviteVersion: version, issuedAt: clock() });
          return token;
        });
        tx.update(ref, { status: 'active', ...reminderFields(order), updatedAt: clock() });
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
    async publishEvent(request) {
      const ref = orderRef(request.data?.orderId);
      const token = publicTokenFor(ref.id);
      const tokenHash = hash(token);
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        if (request.auth?.token?.admin !== true) owned(request, order);
        else admin(request);
        assertReady(order, clock());
        const mappingRef = db.doc(`publicEventTokens/${tokenHash}`);
        const mapping = await tx.get(mappingRef);
        if (mapping.exists && order.shareTokenHash === tokenHash) {
          if (!Array.isArray(order.reminderSchedule))
            tx.update(ref, { ...reminderFields(order), updatedAt: clock() });
          return { token, registrationMode: order.registrationMode, replayed: true };
        }
        if (!mapping.exists)
          tx.create(mappingRef, {
            orderId: ref.id,
            ownerUid: order.ownerUid,
            expiresAt: order.eventAt + 6 * 3600000,
            createdAt: clock(),
          });
        tx.update(ref, {
          shareTokenHash: tokenHash,
          publishedAt: order.publishedAt || clock(),
          status: 'active',
          ...reminderFields(order),
          updatedAt: clock(),
        });
        audit(tx, request, 'event.published', ref.id);
        return { token, registrationMode: order.registrationMode, replayed: false };
      });
    },
    async getPublicEvent(request) {
      const { order } = await db.runTransaction((tx) => publicEvent(tx, request.data?.token));
      return attachApprovedDesign(publicEventView(order), order);
    },
    async registerPublicGuest(request) {
      const input = request.data || {};
      const rid = requestId(input.requestId);
      demand(input.privacyAccepted === true, 'الموافقة على سياسة الخصوصية مطلوبة.');
      const phone = normalizeSaudiPhone(request.auth?.token?.phone_number);
      demand(phone, 'تحقق من رقم جوالك أولًا.', 'unauthenticated');
      const result = await db.runTransaction(async (tx) => {
        const { ref, order } = await publicEvent(tx, input.token);
        demand(
          order.registrationMode === 'open',
          'هذه المناسبة تستخدم قائمة خاصة.',
          'failed-precondition',
        );
        demand(order.eventAt > clock(), 'انتهى التسجيل لهذه المناسبة.', 'failed-precondition');
        const invitationLimit = order.invitationLimit || order.expectedGuests;
        const guestId = hash(`${ref.id}:${phone}`).slice(0, 28);
        const guestRef = ref.collection('guests').doc(guestId);
        const contactRef = ref.collection('guestContacts').doc(guestId);
        const [guestSnap, contactSnap] = await tx.getAll(guestRef, contactRef);
        if (guestSnap.exists) {
          const guest = guestSnap.data();
          demand(
            contactSnap.exists && contactSnap.data().phone === phone,
            'تعذر التحقق من التسجيل.',
            'permission-denied',
          );
          const version = guest.inviteVersion || 1;
          return {
            token: invitationTokenFor(ref.id, guestId, phone, version),
            duplicate: true,
          };
        }
        demand(
          (order.guestCount || 0) < invitationLimit,
          'اكتمل عدد أرقام الدعوات؛ يرجى التواصل مع صاحب المناسبة.',
          'resource-exhausted',
        );
        const guestPolicy = {
          companionsLimit: order.maxCompanions || 0,
          companionNamesRequired: order.companionNamesRequired !== false,
        };
        const response = normalizeRsvp(input, guestPolicy);
        const seats = response.attendance === 'yes' ? 1 + response.companions : 0;
        const currentSeats = order.acceptedSeats || 0;
        const seatCapacity = order.seatCapacity || order.expectedGuests;
        const capacityReached = seats > 0 && currentSeats + seats > seatCapacity;
        demand(
          !capacityReached || order.allowWaitlist === true,
          'اكتمل العدد المخصص للحضور؛ يرجى التواصل مع صاحب المناسبة.',
          'resource-exhausted',
        );
        const state = capacityReached ? 'waitlist' : response.attendance;
        const version = 1;
        const inviteToken = invitationTokenFor(ref.id, guestId, phone, version);
        const inviteHash = hash(inviteToken);
        const guest = {
          id: guestId,
          orderId: ref.id,
          ownerUid: order.ownerUid,
          displayName: response.guestName,
          responseName: response.guestName,
          phoneMasked: `${phone.slice(0, 4)}•••••${phone.slice(-4)}`,
          companionsLimit: order.maxCompanions || 0,
          companionNamesRequired: order.companionNamesRequired !== false,
          companions: ['yes', 'waitlist'].includes(state) ? response.companions : 0,
          companionNames: ['yes', 'waitlist'].includes(state) ? response.companionNames : [],
          message: response.message,
          rsvpState: state,
          rsvpAt: clock(),
          privacyAcceptedAt: clock(),
          privacyVersion: '2026-09-26',
          rsvpRequestId: rid,
          responseHash: hash(JSON.stringify(response)),
          inviteHash,
          inviteVersion: version,
          issuedAt: clock(),
          checkedInAt: null,
          createdAt: clock(),
          source: 'open_registration',
        };
        if (state === 'yes') {
          const ticket = ticketFor(inviteToken, ref.id, guestId);
          guest.ticketHash = hash(ticket);
        }
        tx.create(guestRef, guest);
        tx.create(contactRef, { phone });
        tx.create(db.doc(`inviteTokens/${inviteHash}`), {
          orderId: ref.id,
          guestId,
          expiresAt: order.eventAt + 6 * 3600000,
        });
        const updates = {
          guestCount: (order.guestCount || 0) + 1,
          messageCount: (order.messageCount || 0) + (response.message ? 1 : 0),
          updatedAt: clock(),
        };
        if (state === 'yes') {
          tx.create(db.doc(`ticketTokens/${guest.ticketHash}`), {
            orderId: ref.id,
            guestId,
            expiresAt: order.eventAt + 6 * 3600000,
          });
          updates.acceptedCount = (order.acceptedCount || 0) + 1;
          updates.acceptedSeats = currentSeats + seats;
          capacityAlerts(tx, ref, order, updates.acceptedSeats);
        } else if (state === 'no') updates.declinedCount = (order.declinedCount || 0) + 1;
        else updates.waitlistCount = (order.waitlistCount || 0) + 1;
        tx.update(ref, updates);
        audit(tx, request, 'guest.open_registered', ref.id, { guestId, state });
        return { token: inviteToken, duplicate: false };
      });
      return {
        ...(await publicInvitation(result.token)),
        duplicate: result.duplicate,
        invitationToken: result.token,
      };
    },
    async getInvitation(request) {
      return publicInvitation(request.data?.token);
    },
    async submitRsvp(request) {
      const input = request.data || {};
      const rid = requestId(input.requestId);
      demand(input.privacyAccepted === true, 'الموافقة على سياسة الخصوصية مطلوبة.');
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
        const seats = response.attendance === 'yes' ? 1 + response.companions : 0;
        const acceptedSeats = order.acceptedSeats || 0;
        const seatCapacity = order.seatCapacity || order.expectedGuests;
        const capacityReached =
          response.attendance === 'yes' && acceptedSeats + seats > seatCapacity;
        demand(
          !capacityReached || order.allowWaitlist === true,
          'اكتمل العدد المخصص للحضور؛ يرجى التواصل مع صاحب المناسبة.',
          'resource-exhausted',
        );
        const state = capacityReached ? 'waitlist' : response.attendance;
        const patch = {
          rsvpState: state,
          responseName: response.guestName,
          companions: response.companions,
          companionNames: response.companionNames,
          message: response.message,
          rsvpAt: clock(),
          privacyAcceptedAt: clock(),
          privacyVersion: '2026-09-26',
          rsvpRequestId: rid,
          responseHash,
        };
        if (state === 'yes') {
          const ticket = ticketFor(input.token, inv.orderId, inv.guestId);
          patch.ticketHash = hash(ticket);
          tx.create(db.doc(`ticketTokens/${patch.ticketHash}`), {
            orderId: inv.orderId,
            guestId: inv.guestId,
            expiresAt: order.eventAt + 6 * 3600000,
          });
        }
        tx.update(guestRef, patch);
        const counter =
          state === 'yes' ? 'acceptedCount' : state === 'no' ? 'declinedCount' : 'waitlistCount';
        const updates = {
          [counter]: (order[counter] || 0) + 1,
          messageCount: (order.messageCount || 0) + (response.message ? 1 : 0),
          updatedAt: clock(),
        };
        if (state === 'yes') {
          updates.acceptedSeats = acceptedSeats + seats;
          capacityAlerts(tx, ref, order, updates.acceptedSeats);
        }
        tx.update(ref, updates);
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
          companionNames: guest.companionNames || [],
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
        tx.update(ref, {
          checkedInCount: (order.checkedInCount || 0) + 1,
          checkedInSeats: (order.checkedInSeats || 0) + 1 + (guest.companions || 0),
          updatedAt: clock(),
        });
        audit(tx, request, 'guest.checked_in', ref.id, { guestId: guest.id });
        return { checkedIn: true, alreadyCheckedIn: false };
      });
    },
    async reopenRsvp(request) {
      const ref = orderRef(request.data?.orderId);
      const guestId = request.data?.guestId;
      demand(validId(guestId), 'معرف الضيف غير صحيح.');
      const guestRef = ref.collection('guests').doc(guestId);
      return db.runTransaction(async (tx) => {
        const [orderSnap, guestSnap] = await tx.getAll(ref, guestRef);
        const order = exists(orderSnap);
        const guest = exists(guestSnap);
        if (request.auth?.token?.admin !== true) owned(request, order);
        else admin(request);
        demand(
          order.eventAt > clock(),
          'انتهت المناسبة ولا يمكن إعادة فتح الرد.',
          'failed-precondition',
        );
        if (guest.rsvpState === 'pending') return { reopened: true, replayed: true };
        const updates = { updatedAt: clock() };
        if (guest.rsvpState === 'yes') {
          updates.acceptedCount = Math.max(0, (order.acceptedCount || 0) - 1);
          updates.acceptedSeats = Math.max(
            0,
            (order.acceptedSeats || 0) - 1 - (guest.companions || 0),
          );
          if (guest.checkedInAt) {
            updates.checkedInCount = Math.max(0, (order.checkedInCount || 0) - 1);
            updates.checkedInSeats = Math.max(
              0,
              (order.checkedInSeats || 0) - 1 - (guest.companions || 0),
            );
          }
        } else if (guest.rsvpState === 'no')
          updates.declinedCount = Math.max(0, (order.declinedCount || 0) - 1);
        else if (guest.rsvpState === 'waitlist')
          updates.waitlistCount = Math.max(0, (order.waitlistCount || 0) - 1);
        if (guest.message) updates.messageCount = Math.max(0, (order.messageCount || 0) - 1);
        if (guest.ticketHash) tx.delete(db.doc(`ticketTokens/${guest.ticketHash}`));
        tx.update(guestRef, {
          rsvpState: 'pending',
          responseName: null,
          companions: 0,
          companionNames: [],
          message: '',
          rsvpAt: null,
          rsvpRequestId: null,
          responseHash: null,
          ticketHash: null,
          checkedInAt: null,
        });
        tx.update(ref, updates);
        audit(tx, request, 'rsvp.reopened', ref.id, { guestId });
        return { reopened: true, replayed: false };
      });
    },
    async getOrderReport(request) {
      const ref = orderRef(request.data?.orderId);
      const order = exists(await ref.get());
      if (request.auth?.token?.admin !== true) owned(request, order);
      else admin(request);
      const pageSize = request.data?.pageSize ?? 500;
      demand(
        Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 500,
        'حجم صفحة التقرير غير صحيح.',
      );
      const cursor = request.data?.cursor || null;
      demand(cursor === null || validId(cursor), 'مؤشر صفحة التقرير غير صحيح.');
      let guestQuery = ref.collection('guests').orderBy(FieldPath.documentId()).limit(pageSize);
      if (cursor) guestQuery = guestQuery.startAfter(cursor);
      const guestSnap = await guestQuery.get();
      const contacts = guestSnap.docs.length
        ? await db.getAll(
            ...guestSnap.docs.map((doc) => ref.collection('guestContacts').doc(doc.id)),
          )
        : [];
      const guests = guestSnap.docs.map((doc, index) => {
        const guest = doc.data();
        const contact = contacts[index];
        return {
          id: doc.id,
          name: guest.responseName || guest.displayName,
          phone: contact.exists ? contact.data().phone : '',
          response: guest.rsvpState,
          companionNames: guest.companionNames || [],
          seats: guest.rsvpState === 'yes' ? 1 + (guest.companions || 0) : 0,
          checkedIn: !!guest.checkedInAt,
          noShow: order.eventAt < clock() && guest.rsvpState === 'yes' && !guest.checkedInAt,
          message: guest.message || '',
          source: guest.source || 'private_list',
        };
      });
      return {
        order: {
          id: ref.id,
          honorees: order.honorees,
          eventAt: order.eventAt,
          invitationLimit: order.invitationLimit || order.expectedGuests,
          seatCapacity: order.seatCapacity || order.expectedGuests,
          guestCount: order.guestCount || 0,
          acceptedCount: order.acceptedCount || 0,
          acceptedSeats: order.acceptedSeats || 0,
          declinedCount: order.declinedCount || 0,
          waitlistCount: order.waitlistCount || 0,
          checkedInCount: order.checkedInCount || 0,
          checkedInSeats: order.checkedInSeats || 0,
        },
        guests,
        nextCursor:
          guestSnap.size === pageSize && guestSnap.docs.length ? guestSnap.docs.at(-1).id : null,
      };
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
      const input = request.data || {};
      const ownerUid = uid(request);
      const rid = requestId(input.requestId);
      const ref = orderRef(input.orderId);
      const attemptId = hash(`payment:${ownerUid}:${ref.id}:${rid}`).slice(0, 28);
      const attemptRef = ref.collection('paymentAttempts').doc(attemptId);
      const now = clock();
      const prepared = await db.runTransaction(async (tx) => {
        const [orderSnap, attemptSnap] = await tx.getAll(ref, attemptRef);
        const order = exists(orderSnap);
        owned(request, order);
        if (order.paymentStatus === 'paid') return { paid: true };
        const pricing = payablePricing(order, now);
        const contentHash = hash(
          JSON.stringify({
            orderId: ref.id,
            ownerUid,
            amountHalalas: pricing.totalHalalas,
            currency: pricing.currency,
          }),
        );
        if (attemptSnap.exists) {
          const attempt = attemptSnap.data();
          demand(
            attempt.contentHash === contentHash,
            'استُخدم معرف عملية الدفع لمبلغ مختلف.',
            'already-exists',
          );
          if (attempt.status === 'ready') {
            return {
              existing: true,
              invoiceId: attempt.invoiceId,
              checkoutUrl: attempt.checkoutUrl,
              expiresAt: attempt.expiresAt,
              paymentStatus: attempt.paymentStatus,
            };
          }
          demand(
            attempt.status !== 'creating' || attempt.lockExpiresAt <= now,
            'يجري إنشاء جلسة الدفع؛ انتظر قليلًا ثم حدّث الصفحة.',
            'aborted',
          );
        }
        const session = order.paymentSession;
        if (
          ['pending', 'processing'].includes(order.paymentStatus) &&
          session?.provider === 'moyasar' &&
          session.amountHalalas === pricing.totalHalalas &&
          session.currency === pricing.currency &&
          session.expiresAt > now &&
          typeof session.checkoutUrl === 'string'
        ) {
          return {
            existing: true,
            invoiceId: session.invoiceId,
            checkoutUrl: session.checkoutUrl,
            expiresAt: session.expiresAt,
            paymentStatus: order.paymentStatus,
          };
        }
        demand(
          order.paymentStatus !== 'processing',
          'عملية الدفع قيد المعالجة لدى المزود. حدّث حالتها قبل بدء محاولة أخرى.',
          'failed-precondition',
        );
        demand(
          !order.paymentCreateLock ||
            order.paymentCreateLock.expiresAt <= now ||
            order.paymentCreateLock.attemptId === attemptId,
          'هناك عملية دفع أخرى قيد الإنشاء. انتظر قليلًا ثم حدّث الصفحة.',
          'resource-exhausted',
        );
        const lockExpiresAt = now + 2 * 60_000;
        const attempt = {
          id: attemptId,
          orderId: ref.id,
          ownerUid,
          provider: 'moyasar',
          contentHash,
          amountHalalas: pricing.totalHalalas,
          currency: pricing.currency,
          status: 'creating',
          createdAt: attemptSnap.exists ? attemptSnap.data().createdAt : now,
          updatedAt: now,
          lockExpiresAt,
        };
        if (attemptSnap.exists) tx.update(attemptRef, attempt);
        else tx.create(attemptRef, attempt);
        tx.update(ref, { paymentCreateLock: { attemptId, expiresAt: lockExpiresAt } });
        return {
          create: true,
          amountHalalas: pricing.totalHalalas,
          currency: pricing.currency,
          quoteExpiresAt: pricing.expiresAt,
          eventAt: order.eventAt,
        };
      });

      if (prepared.paid) return { paymentStatus: 'paid' };
      if (prepared.existing) return prepared;

      const invoiceExpiresAt = Math.min(
        now + 30 * 60_000,
        prepared.quoteExpiresAt,
        prepared.eventAt,
      );
      let invoice;
      try {
        invoice = await gateway().createInvoice({
          orderId: ref.id,
          attemptId,
          amount: prepared.amountHalalas,
          currency: prepared.currency,
          expiresAt: invoiceExpiresAt,
        });
        demand(
          invoice.status === 'initiated' &&
            invoice.checkoutUrl &&
            invoice.amount === prepared.amountHalalas &&
            invoice.currency === prepared.currency,
          'تعذر إنشاء فاتورة دفع مطابقة للطلب.',
          'failed-precondition',
        );
      } catch (error) {
        await db.runTransaction(async (tx) => {
          const [orderSnap, attemptSnap] = await tx.getAll(ref, attemptRef);
          if (attemptSnap.exists)
            tx.update(attemptRef, {
              status: 'failed',
              failureCode: error?.code || 'unavailable',
              updatedAt: clock(),
            });
          if (orderSnap.exists && orderSnap.data().paymentCreateLock?.attemptId === attemptId)
            tx.update(ref, { paymentCreateLock: null, updatedAt: clock() });
        });
        gatewayFailure(error);
      }
      const expiresAt = invoice.expiredAt || invoiceExpiresAt;
      const mappingRef = db.doc(`paymentInvoices/${invoice.id}`);
      return db.runTransaction(async (tx) => {
        const [orderSnap, attemptSnap, mappingSnap] = await tx.getAll(ref, attemptRef, mappingRef);
        const order = exists(orderSnap);
        const attempt = exists(attemptSnap);
        owned(request, order);
        demand(
          attempt.contentHash ===
            hash(
              JSON.stringify({
                orderId: ref.id,
                ownerUid,
                amountHalalas: prepared.amountHalalas,
                currency: prepared.currency,
              }),
            ),
          'تغيرت عملية الدفع قبل حفظها.',
          'aborted',
        );
        if (attempt.status === 'ready') {
          return {
            existing: true,
            invoiceId: attempt.invoiceId,
            checkoutUrl: attempt.checkoutUrl,
            expiresAt: attempt.expiresAt,
            paymentStatus: attempt.paymentStatus,
          };
        }
        demand(
          order.paymentCreateLock?.attemptId === attemptId,
          'انتهت مهلة إنشاء الدفع؛ حدّث الصفحة قبل المحاولة.',
          'aborted',
        );
        if (mappingSnap.exists) {
          demand(
            mappingSnap.data().orderId === ref.id && mappingSnap.data().attemptId === attemptId,
            'تعارض معرف فاتورة الدفع.',
            'already-exists',
          );
        } else {
          tx.create(mappingRef, {
            invoiceId: invoice.id,
            provider: 'moyasar',
            orderId: ref.id,
            attemptId,
            ownerUid,
            amountHalalas: invoice.amount,
            currency: invoice.currency,
            providerStatus: invoice.status,
            createdAt: clock(),
            checkedAt: clock(),
          });
        }
        tx.update(attemptRef, {
          status: 'ready',
          invoiceId: invoice.id,
          checkoutUrl: invoice.checkoutUrl,
          expiresAt,
          providerStatus: invoice.status,
          paymentStatus: 'pending',
          updatedAt: clock(),
        });
        tx.update(ref, {
          paymentStatus: 'pending',
          paymentCreateLock: null,
          paymentSession: {
            provider: 'moyasar',
            attemptId,
            invoiceId: invoice.id,
            checkoutUrl: invoice.checkoutUrl,
            expiresAt,
            providerStatus: invoice.status,
            amountHalalas: invoice.amount,
            currency: invoice.currency,
            createdAt: clock(),
          },
          updatedAt: clock(),
        });
        audit(tx, request, 'payment.session_created', ref.id, { invoiceId: invoice.id });
        return {
          invoiceId: invoice.id,
          checkoutUrl: invoice.checkoutUrl,
          expiresAt,
          paymentStatus: 'pending',
        };
      });
    },
    async syncPaymentSession(request) {
      const ref = orderRef(request.data?.orderId);
      const order = exists(await ref.get());
      owned(request, order);
      const invoiceId = order.paymentSession?.invoiceId || order.paidInvoiceId;
      demand(invoiceId, 'لا توجد جلسة دفع لهذا الطلب.', 'failed-precondition');
      let invoice;
      try {
        invoice = await gateway().fetchInvoice(invoiceId);
      } catch (error) {
        gatewayFailure(error);
      }
      await reconcilePayment(invoice, { source: 'customer_sync', actorUid: request.auth.uid });
      const updated = exists(await ref.get());
      return {
        paymentStatus: updated.paymentStatus,
        checkoutUrl:
          ['pending', 'processing'].includes(updated.paymentStatus) &&
          updated.paymentSession?.expiresAt > clock()
            ? updated.paymentSession.checkoutUrl
            : null,
        expiresAt: updated.paymentSession?.expiresAt || null,
      };
    },
    async sendInvitations(request) {
      admin(request);
      const ref = orderRef(request.data?.orderId);
      const ids = request.data?.guestIds;
      demand(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 25 &&
          ids.every(validId) &&
          new Set(ids).size === ids.length,
        'اختر من 1 إلى 25 ضيفًا مختلفًا للإرسال في الدفعة.',
      );
      const order = exists(await ref.get());
      demand(
        order.status === 'active' && order.paymentStatus === 'paid',
        'انشر المناسبة وأكمل الدفع قبل الإرسال.',
        'failed-precondition',
      );
      const origin = new URL(siteOrigin());
      demand(origin.protocol === 'https:', 'نطاق الموقع العام غير صالح.', 'failed-precondition');
      const results = [];
      for (const guestId of ids) {
        const guestRef = ref.collection('guests').doc(guestId);
        const [guestSnap, contactSnap] = await Promise.all([
          guestRef.get(),
          ref.collection('guestContacts').doc(guestId).get(),
        ]);
        const guest = exists(guestSnap);
        const contact = exists(contactSnap);
        demand(guest.inviteVersion && guest.inviteHash, 'أنشئ رابط الضيف قبل الإرسال.');
        const token = invitationTokenFor(ref.id, guestId, contact.phone, guest.inviteVersion);
        demand(hash(token) === guest.inviteHash, 'تعذر استعادة رابط الضيف الآمن.');
        const deliveryRef = ref
          .collection('deliveryLogs')
          .doc(`invitation-${guestId}-${guest.inviteVersion}`);
        const claimed = await db.runTransaction(async (tx) => {
          const old = await tx.get(deliveryRef);
          if (old.exists && old.data().status === 'sent') return false;
          if (old.exists && old.data().status === 'sending' && old.data().lockExpiresAt > clock())
            return false;
          const value = {
            type: 'invitation',
            guestId,
            status: 'sending',
            attemptCount: (old.exists ? old.data().attemptCount || 0 : 0) + 1,
            lockExpiresAt: clock() + 120000,
            updatedAt: clock(),
          };
          if (old.exists) tx.update(deliveryRef, value);
          else tx.create(deliveryRef, { ...value, createdAt: clock() });
          return true;
        });
        if (!claimed) {
          results.push({ guestId, status: 'skipped' });
          continue;
        }
        const link = new URL('invitation.html', origin);
        link.hash = new URLSearchParams({ token });
        try {
          const sent = await messenger().sendTemplate({
            to: contact.phone,
            template: 'invitation',
            variables: [
              guest.displayName,
              order.honorees,
              order.eventDate,
              order.eventTime,
              order.venueName,
              link.href,
            ],
          });
          await deliveryRef.update({
            status: 'sent',
            provider: sent.provider,
            providerMessageId: sent.messageId,
            sentAt: clock(),
            lockExpiresAt: 0,
            updatedAt: clock(),
          });
          results.push({ guestId, status: 'sent' });
        } catch (error) {
          await deliveryRef.update({
            status: 'failed',
            failureCode: error?.code || 'unavailable',
            lockExpiresAt: 0,
            updatedAt: clock(),
          });
          results.push({ guestId, status: 'failed' });
        }
      }
      return {
        sent: results.filter((item) => item.status === 'sent').length,
        failed: results.filter((item) => item.status === 'failed').length,
        skipped: results.filter((item) => item.status === 'skipped').length,
      };
    },
    async scheduleReminders(request) {
      admin(request);
      const ref = orderRef(request.data?.orderId);
      return db.runTransaction(async (tx) => {
        const order = exists(await tx.get(ref));
        demand(order.status === 'active', 'انشر المناسبة قبل جدولة التذكيرات.');
        const hours = normalizeReminderHours(request.data?.hours ?? order.reminderHours);
        const schedule = hours.map((value) => ({
          hours: value,
          at: reminderTimestamp(order, value, clock()),
          status: 'scheduled',
        }));
        tx.update(ref, {
          reminderHours: hours,
          reminderSchedule: schedule,
          nextReminderAt: Math.min(...schedule.map((item) => item.at)),
          reminderStatus: 'scheduled',
          updatedAt: clock(),
        });
        audit(tx, request, 'reminders.scheduled', ref.id, { hours });
        return { schedule };
      });
    },
  };
  return { handlers, rateLimit, reconcilePayment };
}
