import { initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

import { createService } from './service.js';
import { DomainError, demand } from './lib/domain.js';
import { createMoyasarGateway, isMoyasarInvoiceId, MoyasarError } from './payment/moyasar.js';
import { createWhatsAppProvider } from './messaging/whatsapp.js';

initializeApp();

const FUNCTIONS_REGION = 'me-central2';
const ticketKey = defineSecret('TICKET_SIGNING_KEY');
const moyasarSecretKey = defineSecret('MOYASAR_SECRET_KEY');
const moyasarWebhookToken = defineSecret('MOYASAR_WEBHOOK_TOKEN');
const whatsappAccessToken = defineSecret('WHATSAPP_ACCESS_TOKEN');
const whatsappPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', {
  default: '',
  description: 'Meta WhatsApp Cloud API phone number ID.',
});
const whatsappInvitationTemplate = defineString('WHATSAPP_INVITATION_TEMPLATE', {
  default: 'medad_invitation_ar',
  description: 'Approved Arabic WhatsApp invitation template name.',
});
const whatsappReminderTemplate = defineString('WHATSAPP_REMINDER_TEMPLATE', {
  default: 'medad_reminder_ar',
  description: 'Approved Arabic WhatsApp reminder template name.',
});
const whatsappGraphApiVersion = defineString('WHATSAPP_GRAPH_API_VERSION', {
  default: 'v22.0',
  description: 'Supported Meta Graph API version, for example v22.0.',
});
const publicSiteOrigin = defineString('PUBLIC_SITE_ORIGIN', {
  default: 'https://medadtahaya.com',
  description: 'Canonical HTTPS origin hosting the checkout page, without a path.',
});

function callbackUrl() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  demand(
    typeof projectId === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId),
    'تعذر تحديد مشروع Firebase لرابط إشعار الدفع.',
    'failed-precondition',
  );
  const token = moyasarWebhookToken.value();
  demand(
    typeof token === 'string' && token.length >= 32,
    'رمز إشعار الدفع غير مهيأ.',
    'failed-precondition',
  );
  const url = new URL(
    `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/moyasarInvoiceCallback`,
  );
  url.searchParams.set('token', token);
  return url.href;
}

const paymentGateway = createMoyasarGateway({
  secretKey: () => moyasarSecretKey.value(),
  siteOrigin: () => publicSiteOrigin.value(),
  callbackUrl,
});

const messagingProvider = createWhatsAppProvider({
  accessToken: () => whatsappAccessToken.value(),
  phoneNumberId: () => whatsappPhoneNumberId.value(),
  invitationTemplate: () => whatsappInvitationTemplate.value(),
  reminderTemplate: () => whatsappReminderTemplate.value(),
  apiVersion: () => whatsappGraphApiVersion.value(),
});

async function verifyFile(path, kind) {
  const file = getStorage().bucket().file(path);
  const [meta] = await file.getMetadata();

  demand(
    Number(meta.size) > 0 && Number(meta.size) <= 10 * 1024 * 1024,
    'حجم الملف يجب ألا يتجاوز 10MB.',
  );

  const [prefix] = await file.download({
    start: 0,
    end: 31,
  });

  const formats = [
    ['image/png', prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
    ['image/jpeg', prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255],
    [
      'image/webp',
      prefix.subarray(0, 4).toString() === 'RIFF' && prefix.subarray(8, 12).toString() === 'WEBP',
    ],
    ['application/pdf', kind === 'reference' && prefix.subarray(0, 5).toString() === '%PDF-'],
  ];

  demand(
    formats.some(([mime, matches]) => matches && meta.contentType === mime),
    'محتوى الملف لا يطابق نوعه المسموح.',
  );
}

async function privateAssetUrl(path) {
  demand(
    typeof path === 'string' &&
      /^orders\/[A-Za-z0-9_-]{16,80}\/design\/[A-Za-z0-9_-]{43}$/.test(path),
    'مسار التصميم غير صحيح.',
  );
  const [url] = await getStorage()
    .bucket()
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60_000 });
  return url;
}

const db = getFirestore();
const service = createService({
  db,
  ticketKey: () => ticketKey.value(),
  qrCode: (payload) =>
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      width: 256,
      margin: 2,
    }),
  verifyFile,
  paymentGateway,
  messagingProvider,
  privateAssetUrl,
  siteOrigin: () => publicSiteOrigin.value(),
});

const emulator = process.env.FUNCTIONS_EMULATOR === 'true';

function endpoint(name, { publicAccess = false, secrets = [] } = {}) {
  return onCall(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: !emulator,
      maxInstances: 5,
      timeoutSeconds: 60,
      memory: '256MiB',
      secrets,
    },
    async (request) => {
      try {
        if (!publicAccess && !request.auth) {
          throw new HttpsError('unauthenticated', 'سجل الدخول أولًا.');
        }

        let checked = request;

        if (request.auth) {
          const user = await getAuth().getUser(request.auth.uid);
          const revokedAt = Date.parse(user.tokensValidAfterTime || '1970-01-01');
          const authenticatedAt = Number(request.auth.token.auth_time) * 1000;

          if (user.disabled || authenticatedAt < revokedAt) {
            throw new HttpsError('unauthenticated', 'انتهت صلاحية الجلسة؛ سجل الدخول مجددًا.');
          }

          checked = {
            ...request,
            auth: {
              ...request.auth,
              token: {
                ...request.auth.token,
                admin: user.customClaims?.admin === true,
                gate: user.customClaims?.gate === true,
                phone_number: user.phoneNumber || '',
              },
            },
          };
        }

        const limits = {
          createOrder: 15,
          createPaymentSession: 10,
          syncPaymentSession: 30,
          registerPublicGuest: 12,
          submitRsvp: 20,
          publishEvent: 20,
          getOrderReport: 30,
          getPublicEvent: 1000,
          getInvitation: 120,
        };
        await service.rateLimit(checked, name, limits[name] || 120);

        return await service.handlers[name](checked);
      } catch (error) {
        if (error instanceof HttpsError) {
          throw error;
        }

        if (error instanceof DomainError) {
          throw new HttpsError(error.code, error.message);
        }

        console.error('Operation failed', {
          operation: name,
          code: error.code || 'unknown',
        });

        throw new HttpsError('internal', 'تعذر إتمام العملية؛ حاول لاحقًا.');
      }
    },
  );
}

export const createOrder = endpoint('createOrder');
export const approvePricing = endpoint('approvePricing');

export const saveReminderPreference = endpoint('saveReminderPreference');

export const prepareUpload = endpoint('prepareUpload');
export const registerUpload = endpoint('registerUpload');
export const approveDesign = endpoint('approveDesign');
export const importGuests = endpoint('importGuests');
export const issueInvitations = endpoint('issueInvitations', { secrets: [ticketKey] });

export const publishEvent = endpoint('publishEvent', { secrets: [ticketKey] });
export const getPublicEvent = endpoint('getPublicEvent', {
  publicAccess: true,
  secrets: [ticketKey],
});
export const registerPublicGuest = endpoint('registerPublicGuest', { secrets: [ticketKey] });

export const getInvitation = endpoint('getInvitation', {
  publicAccess: true,
  secrets: [ticketKey],
});

export const submitRsvp = endpoint('submitRsvp', {
  publicAccess: true,
  secrets: [ticketKey],
});

export const verifyTicket = endpoint('verifyTicket');
export const checkInTicket = endpoint('checkInTicket');
export const reopenRsvp = endpoint('reopenRsvp');
export const getOrderReport = endpoint('getOrderReport');
export const getGateAssignments = endpoint('getGateAssignments');

export const createPaymentSession = endpoint('createPaymentSession', {
  secrets: [moyasarSecretKey, moyasarWebhookToken],
});
export const syncPaymentSession = endpoint('syncPaymentSession', {
  secrets: [moyasarSecretKey],
});

function sameSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const moyasarInvoiceCallback = onRequest(
  {
    region: FUNCTIONS_REGION,
    maxInstances: 5,
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [moyasarSecretKey, moyasarWebhookToken],
    cors: false,
  },
  async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.status(405).set('Allow', 'POST').send('Method Not Allowed');
      return;
    }
    if (!sameSecret(request.query.token, moyasarWebhookToken.value())) {
      response.status(404).send('Not Found');
      return;
    }
    if (Number(request.get('content-length') || 0) > 64 * 1024) {
      response.status(413).send('Payload Too Large');
      return;
    }
    const invoiceId = request.body?.id;
    if (!isMoyasarInvoiceId(invoiceId)) {
      response.status(400).send('Invalid invoice');
      return;
    }
    try {
      await service.rateLimit({ rawRequest: request }, 'moyasarWebhook', 300);
      const invoice = await paymentGateway.fetchInvoice(invoiceId);
      await service.reconcilePayment(invoice, { source: 'moyasar_callback' });
      response.status(204).send('');
    } catch (error) {
      console.error('Payment callback failed', {
        code: error?.code || 'unknown',
        providerStatus: error instanceof MoyasarError ? error.status : undefined,
      });
      const retryable =
        error instanceof MoyasarError ||
        !(error instanceof DomainError) ||
        ['unavailable', 'not-found', 'aborted'].includes(error.code);
      response.status(retryable ? 503 : 409).send('Unable to reconcile invoice');
    }
  },
);

export const sendInvitations = endpoint('sendInvitations', {
  secrets: [ticketKey, whatsappAccessToken],
});
export const scheduleReminders = endpoint('scheduleReminders');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const reminderToken = (orderId, guestId, phone, version) =>
  createHmac('sha256', ticketKey.value())
    .update(['invite', 'v2', orderId, guestId, phone, String(version)].join(':'))
    .digest('base64url');

async function claimReminder(deliveryRef, now, hours, guestId) {
  return db.runTransaction(async (tx) => {
    const old = await tx.get(deliveryRef);
    if (old.exists && old.data().status === 'sent') return 'sent';
    if (old.exists && old.data().status === 'sending' && old.data().lockExpiresAt > now)
      return 'locked';
    const value = {
      type: 'reminder',
      hours,
      guestId,
      status: 'sending',
      attemptCount: (old.exists ? old.data().attemptCount || 0 : 0) + 1,
      lockExpiresAt: now + 120000,
      updatedAt: now,
    };
    if (old.exists) tx.update(deliveryRef, value);
    else tx.create(deliveryRef, { ...value, createdAt: now });
    return 'claimed';
  });
}

async function dispatchReminderPage(orderDoc, now) {
  const order = orderDoc.data();
  const orderRef = orderDoc.ref;
  const schedule = Array.isArray(order.reminderSchedule) ? order.reminderSchedule : [];
  if (order.eventAt <= now) {
    await orderRef.update({
      reminderSchedule: schedule.map((item) =>
        item.status === 'scheduled' ? { ...item, status: 'missed' } : item,
      ),
      nextReminderAt: null,
      reminderCursor: null,
      reminderStatus: 'completed',
      updatedAt: now,
    });
    return;
  }
  const dueIndex = schedule.findIndex((item) => item.status === 'scheduled' && item.at <= now);
  if (dueIndex === -1) {
    const next = schedule.filter((item) => item.status === 'scheduled' && item.at > now);
    await orderRef.update({
      nextReminderAt: next.length ? Math.min(...next.map((item) => item.at)) : null,
      reminderStatus: next.length ? 'scheduled' : 'completed',
      updatedAt: now,
    });
    return;
  }
  const due = schedule[dueIndex];
  let query = orderRef.collection('guests').orderBy(FieldPath.documentId()).limit(100);
  if (order.reminderCursor) query = query.startAfter(order.reminderCursor);
  const page = await query.get();
  const origin = new URL(publicSiteOrigin.value());
  if (origin.protocol !== 'https:') throw new Error('PUBLIC_SITE_ORIGIN must use HTTPS.');
  let failed = false;
  const sendOne = async (guestDoc) => {
    const guest = guestDoc.data();
    if (!['pending', 'yes'].includes(guest.rsvpState) || !guest.inviteVersion || !guest.inviteHash)
      return false;
    const contactDoc = await orderRef.collection('guestContacts').doc(guestDoc.id).get();
    if (!contactDoc.exists) return false;
    const phone = contactDoc.data().phone;
    const token = reminderToken(orderDoc.id, guestDoc.id, phone, guest.inviteVersion);
    if (sha256(token) !== guest.inviteHash) return false;
    const deliveryRef = orderRef
      .collection('deliveryLogs')
      .doc(`reminder-${due.hours}-${guestDoc.id}`);
    const claim = await claimReminder(deliveryRef, now, due.hours, guestDoc.id);
    if (claim === 'locked') return true;
    if (claim !== 'claimed') return false;
    const link = new URL('invitation.html', origin);
    link.hash = new URLSearchParams({ token });
    try {
      const sent = await messagingProvider.sendTemplate({
        to: phone,
        template: 'reminder',
        variables: [
          guest.displayName,
          order.honorees,
          String(due.hours),
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
        sentAt: Date.now(),
        lockExpiresAt: 0,
        updatedAt: Date.now(),
      });
      return false;
    } catch (error) {
      await deliveryRef.update({
        status: 'failed',
        failureCode: error?.code || 'unavailable',
        lockExpiresAt: 0,
        updatedAt: Date.now(),
      });
      return true;
    }
  };
  for (let offset = 0; offset < page.docs.length; offset += 10) {
    const results = await Promise.all(page.docs.slice(offset, offset + 10).map(sendOne));
    failed ||= results.some(Boolean);
  }
  if (failed) {
    await orderRef.update({ reminderLastErrorAt: Date.now(), updatedAt: Date.now() });
    return;
  }
  if (page.size === 100) {
    await orderRef.update({ reminderCursor: page.docs.at(-1).id, updatedAt: Date.now() });
    return;
  }
  const completedSchedule = schedule.map((item, index) =>
    index === dueIndex ? { ...item, status: 'sent', sentAt: Date.now() } : item,
  );
  const upcoming = completedSchedule.filter((item) => item.status === 'scheduled');
  await orderRef.update({
    reminderSchedule: completedSchedule,
    reminderCursor: null,
    nextReminderAt: upcoming.length ? Math.min(...upcoming.map((item) => item.at)) : null,
    reminderStatus: upcoming.length ? 'scheduled' : 'completed',
    updatedAt: Date.now(),
  });
}

export const dispatchScheduledReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Riyadh',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [ticketKey, whatsappAccessToken],
  },
  async () => {
    const now = Date.now();
    const due = await db
      .collection('orders')
      .where('status', '==', 'active')
      .where('nextReminderAt', '<=', now)
      .orderBy('nextReminderAt')
      .limit(10)
      .get();
    for (const orderDoc of due.docs) {
      try {
        await dispatchReminderPage(orderDoc, now);
      } catch (error) {
        console.error('Reminder dispatch failed', {
          orderId: orderDoc.id,
          code: error?.code || 'unknown',
        });
      }
    }
  },
);
