import { call } from './firebase-client.js';
import {
  $,
  setText,
  formatDate,
  tokenFromUrl,
  showError,
  busy,
  storageGet,
  storageSet,
} from './platform.js';
let token, record, key;
function renderCompanionNames(count) {
  const required = record?.guest?.companionNamesRequired !== false;
  $('companion-names').replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = `اسم المرافق ${index + 1}`;
      const input = document.createElement('input');
      input.name = 'companionName';
      input.maxLength = 100;
      input.required = required;
      label.append(span, input);
      return label;
    }),
  );
}
function render(result) {
  record = result;
  const { event, guest, response, ticket } = result;
  setText('rsvp-guest', guest.displayName);
  setText('rsvp-event', event.honorees);
  setText('rsvp-date', `${formatDate(event.eventDate)} — ${event.eventTime}`);
  setText('rsvp-venue', `${event.venueName}، ${event.city}`);
  setText('rsvp-child-policy', event.childPolicy || '');
  $('guestName').value = guest.displayName;
  $('companions').replaceChildren(
    ...Array.from({ length: guest.companionsLimit + 1 }, (_, i) => {
      const n = document.createElement('option');
      n.value = String(i);
      n.textContent = i ? `${i} مرافق` : 'بدون مرافقين';
      return n;
    }),
  );
  renderCompanionNames(0);
  $('rsvpFormState').hidden = !!response;
  $('rsvpSuccessState').hidden = !response;
  $('invitation-link').href = `invitation.html#${new URLSearchParams({ token })}`;
  if (response) {
    setText(
      'successTitle',
      response.attendance === 'yes'
        ? 'تم تأكيد حضورك'
        : response.attendance === 'waitlist'
          ? 'أنت في قائمة الانتظار'
          : 'تم تسجيل اعتذارك',
    );
    setText('ticketGuestName', response.guestName);
    setText(
      'ticket-companions',
      response.companionNames?.length
        ? `المرافقون: ${response.companionNames.join('، ')}`
        : 'بدون مرافقين',
    );
    $('ticketCard').hidden = !ticket;
    if (ticket) {
      $('ticket-qr').src = ticket.qrDataUrl;
      setText('ticket-token', ticket.payload);
      setText(
        'ticket-status',
        ticket.checkedIn ? 'تم تسجيل الدخول بهذه البطاقة' : 'أبرز هذه البطاقة عند البوابة.',
      );
    }
  }
}
$('rsvpForm').addEventListener('change', (event) => {
  if (event.target.name === 'attendance') {
    $('attendanceDetails').hidden = event.target.value !== 'yes';
    $('guestName').required = event.target.value === 'yes';
  }
});
$('companions').addEventListener('change', () =>
  renderCompanionNames(Number($('companions').value)),
);
$('rsvpForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!record || record.response) return;
  if (!event.currentTarget.reportValidity()) return;
  busy(event.currentTarget.querySelector('[type=submit]'), async () => {
    try {
      $('rsvpError').hidden = true;
      let requestId = storageGet(key);
      if (!requestId) {
        requestId = crypto.randomUUID();
        storageSet(key, requestId);
      }
      const attendance = new FormData($('rsvpForm')).get('attendance');
      const result = await call('submitRsvp', {
        token,
        requestId,
        attendance,
        guestName: attendance === 'yes' ? $('guestName').value : record.guest.displayName,
        companionNames:
          attendance === 'yes'
            ? [...document.querySelectorAll('[name=companionName]')].map((input) => input.value)
            : [],
        message: $('guest-message').value,
        privacyAccepted: $('rsvp-consent').checked,
      });
      render(result);
    } catch (error) {
      showError(error, 'rsvpError');
      if (error.code === 'functions/already-exists') {
        try {
          render(await call('getInvitation', { token }));
        } catch {}
      }
    }
  });
});
(async () => {
  token = tokenFromUrl();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  key = `medad.rsvp.request.${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  render(await call('getInvitation', { token }));
})().catch(showError);
