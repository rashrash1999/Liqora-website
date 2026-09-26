import { getClient, call } from './firebase-client.js';
import {
  $,
  busy,
  digits,
  formatDate,
  normalizeSaudiPhone,
  safeHttpsUrl,
  setText,
  showError,
  storageGet,
  storageSet,
  tokenFromUrl,
} from './platform.js';

let eventRecord;
let token;
let recaptcha;
let confirmation;
let pendingPayload;

function companionInputs(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = `اسم المرافق ${i + 1}`;
    const input = document.createElement('input');
    input.name = 'companionName';
    input.maxLength = 100;
    input.required = eventRecord.registration.companionNamesRequired;
    label.append(span, input);
    nodes.push(label);
  }
  $('guest-companion-names').replaceChildren(...nodes);
}

function renderEvent(record) {
  eventRecord = record;
  const { event, registration } = record;
  $('public-card').hidden = false;
  $('public-card').className = `guest-invitation theme-${event.theme || 'classic'}`;
  setText('public-occasion', event.occasion);
  setText('public-honorees', event.honorees);
  setText('public-message', event.invitationMessage || 'يسرنا حضوركم ومشاركتكم هذه المناسبة.');
  setText('public-date', formatDate(event.eventDate));
  setText('public-time', `${event.eventTime} بتوقيت الرياض`);
  setText('public-venue', `${event.venueName}، ${event.city}`);
  setText('public-policy', event.childPolicy || '');
  const design = safeHttpsUrl(event.designUrl);
  if (design) {
    $('public-design').src = design;
    $('public-design').hidden = false;
  }
  const map = safeHttpsUrl(event.mapUrl);
  $('public-map').hidden = !map;
  if (map) $('public-map').href = map;
  $('registration-card').hidden = registration.mode !== 'open';
  if (registration.mode !== 'open') {
    showError(
      new Error('هذه المناسبة بقائمة خاصة. افتح الرابط الشخصي الذي أرسله لك صاحب المناسبة.'),
    );
    return;
  }
  const full = !registration.open;
  setText(
    'availability-note',
    full
      ? 'اكتمل العدد المخصص للمناسبة. يمكنك إدخال رقمك لاستعادة تسجيل سابق، وإلا سيطلب منك النظام التواصل مع صاحب المناسبة.'
      : registration.remainingSeats === 0 && registration.allowWaitlist
        ? 'اكتملت المقاعد، والتسجيل الجديد سيُضاف إلى قائمة الانتظار.'
        : `المقاعد المتبقية: ${registration.remainingSeats}. يُسمح حتى ${registration.maxCompanions} مرافقين.`,
  );
  $('guest-details-form').querySelector('[type=submit]').disabled = false;
  $('guest-companions').replaceChildren(
    ...Array.from({ length: registration.maxCompanions + 1 }, (_, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = index ? `${index} مرافق` : 'بدون مرافقين';
      return option;
    }),
  );
}

function payload() {
  const attendance = new FormData($('guest-details-form')).get('attendance');
  return {
    token,
    requestId: storageGet(`medad.open-rsvp.${token}`) || crypto.randomUUID(),
    attendance,
    guestName: $('guest-name').value,
    companionNames:
      attendance === 'yes'
        ? [...document.querySelectorAll('[name=companionName]')].map((input) => input.value)
        : [],
    message: $('guest-message').value,
    privacyAccepted: $('guest-consent').checked,
  };
}

function resultView(result) {
  $('registration-card').hidden = true;
  $('guest-result').hidden = false;
  const state = result.response?.attendance;
  setText(
    'guest-result-title',
    !state
      ? 'تم العثور على تسجيلك'
      : state === 'yes'
        ? result.duplicate
          ? 'أنت مسجل مسبقاً'
          : 'تم تأكيد حضورك'
        : state === 'waitlist'
          ? 'تمت إضافتك إلى قائمة الانتظار'
          : result.duplicate
            ? 'تم تسجيل ردك مسبقاً'
            : 'تم تسجيل اعتذارك',
  );
  setText(
    'guest-result-message',
    !state
      ? 'افتح دعوتك الشخصية لإكمال أو تحديث ردّك.'
      : state === 'yes'
        ? 'شكراً لك. يمكنك العودة إلى رابطك الشخصي في أي وقت.'
        : state === 'waitlist'
          ? 'سيظهر لصاحب المناسبة أنك في قائمة الانتظار.'
          : 'شكراً لإبلاغ صاحب المناسبة.',
  );
  const personal = new URL('invitation.html', location.href);
  if (result.invitationToken) {
    personal.hash = new URLSearchParams({ token: result.invitationToken });
    $('guest-personal-link').href = personal.href;
  }
  $('guest-ticket').hidden = !result.ticket;
  if (result.ticket) $('guest-ticket-qr').src = result.ticket.qrDataUrl;
}

async function saveRegistration() {
  storageSet(`medad.open-rsvp.${token}`, pendingPayload.requestId);
  const result = await call('registerPublicGuest', pendingPayload);
  resultView(result);
}

$('guest-details-form').addEventListener('change', (event) => {
  if (event.target.name === 'attendance')
    $('guest-companion-section').hidden = event.target.value !== 'yes';
});
$('guest-companions').addEventListener('change', () =>
  companionInputs(Number($('guest-companions').value)),
);
$('guest-details-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const phone = normalizeSaudiPhone($('guest-phone').value);
  if (!phone) {
    showError(new Error('أدخل رقم جوال سعودي صحيحًا.'), 'guest-details-error');
    return;
  }
  pendingPayload = payload();
  busy(event.currentTarget.querySelector('[type=submit]'), async () => {
    try {
      const { sdk, auth } = await getClient();
      if (auth.currentUser?.phoneNumber === phone) {
        await auth.currentUser.getIdToken(true);
        await saveRegistration();
        return;
      }
      confirmation = await sdk.signInWithPhoneNumber(auth, phone, recaptcha);
      setText('guest-verification-phone', phone);
      $('guest-details-form').hidden = true;
      $('guest-otp-form').hidden = false;
      $('guest-otp').focus();
    } catch (error) {
      showError(error, 'guest-details-error');
    }
  });
});
$('guest-otp-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = digits($('guest-otp').value).trim();
  if (!/^\d{6}$/.test(code)) {
    showError(new Error('أدخل رمز التحقق المكون من ستة أرقام.'), 'guest-otp-error');
    return;
  }
  busy(event.currentTarget.querySelector('[type=submit]'), async () => {
    try {
      await confirmation.confirm(code);
      await saveRegistration();
    } catch (error) {
      showError(error, 'guest-otp-error');
    }
  });
});
$('guest-change-phone').addEventListener('click', () => {
  confirmation = null;
  $('guest-otp').value = '';
  $('guest-otp-form').hidden = true;
  $('guest-details-form').hidden = false;
});

(async () => {
  token = tokenFromUrl();
  renderEvent(await call('getPublicEvent', { token }));
  const { sdk, auth } = await getClient();
  recaptcha = new sdk.RecaptchaVerifier(auth, 'guest-recaptcha', { size: 'normal' });
  await recaptcha.render();
})().catch(showError);
