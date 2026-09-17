import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import QRCode from 'qrcode';

import { createService } from './service.js';
import { DomainError, demand } from './lib/domain.js';

initializeApp();

const FUNCTIONS_REGION = 'me-central2';
const ticketKey = defineSecret('TICKET_SIGNING_KEY');

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
    [
      'image/png',
      prefix
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ],
    [
      'image/jpeg',
      prefix[0] === 255 &&
        prefix[1] === 216 &&
        prefix[2] === 255,
    ],
    [
      'image/webp',
      prefix.subarray(0, 4).toString() === 'RIFF' &&
        prefix.subarray(8, 12).toString() === 'WEBP',
    ],
    [
      'application/pdf',
      kind === 'reference' &&
        prefix.subarray(0, 5).toString() === '%PDF-',
    ],
  ];

  demand(
    formats.some(
      ([mime, matches]) => matches && meta.contentType === mime,
    ),
    'محتوى الملف لا يطابق نوعه المسموح.',
  );
}

const service = createService({
  db: getFirestore(),
  ticketKey: () => ticketKey.value(),
  qrCode: (payload) =>
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      width: 256,
      margin: 2,
    }),
  verifyFile,
});

const emulator = process.env.FUNCTIONS_EMULATOR === 'true';

function endpoint(
  name,
  {
    publicAccess = false,
    needsTicketKey = false,
  } = {},
) {
  return onCall(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: !emulator,
      maxInstances: 5,
      timeoutSeconds: 60,
      memory: '256MiB',
      secrets: needsTicketKey ? [ticketKey] : [],
    },
    async (request) => {
      try {
        if (!publicAccess && !request.auth) {
          throw new HttpsError(
            'unauthenticated',
            'سجل الدخول أولًا.',
          );
        }

        let checked = request;

        if (request.auth) {
          const user = await getAuth().getUser(request.auth.uid);
          const revokedAt = Date.parse(
            user.tokensValidAfterTime || '1970-01-01',
          );
          const authenticatedAt =
            Number(request.auth.token.auth_time) * 1000;

          if (user.disabled || authenticatedAt < revokedAt) {
            throw new HttpsError(
              'unauthenticated',
              'انتهت صلاحية الجلسة؛ سجل الدخول مجددًا.',
            );
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

        await service.rateLimit(
          checked,
          name,
          name === 'createOrder' ? 15 : 120,
        );

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

        throw new HttpsError(
          'internal',
          'تعذر إتمام العملية؛ حاول لاحقًا.',
        );
      }
    },
  );
}

export const createOrder = endpoint('createOrder');

export const saveReminderPreference = endpoint(
  'saveReminderPreference',
);

export const prepareUpload = endpoint('prepareUpload');
export const registerUpload = endpoint('registerUpload');
export const approveDesign = endpoint('approveDesign');
export const importGuests = endpoint('importGuests');
export const issueInvitations = endpoint('issueInvitations');

export const getInvitation = endpoint('getInvitation', {
  publicAccess: true,
  needsTicketKey: true,
});

export const submitRsvp = endpoint('submitRsvp', {
  publicAccess: true,
  needsTicketKey: true,
});

export const verifyTicket = endpoint('verifyTicket');
export const checkInTicket = endpoint('checkInTicket');
export const getGateAssignments = endpoint(
  'getGateAssignments',
);

export const createPaymentSession = endpoint(
  'createPaymentSession',
);

export const sendInvitations = endpoint('sendInvitations');
export const scheduleReminders = endpoint('scheduleReminders');