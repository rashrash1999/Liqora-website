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
  $('rsvpFormState').hidden = !!response;
  $('rsvpSuccessState').hidden = !response;
  $('invitation-link').href = `invitation.html#${new URLSearchParams({ token })}`;
  if (response) {
    setText('successTitle', response.attendance === 'yes' ? 'تم تأكيد حضورك' : 'تم تسجيل اعتذارك');
    setText('ticketGuestName', response.guestName);
    setText('ticket-companions', `المرافقون: ${response.companions}`);
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
        companions: Number($('companions').value),
        message: $('guest-message').value,
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
