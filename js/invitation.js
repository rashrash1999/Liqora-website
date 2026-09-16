import { call } from './firebase-client.js';
import { $, setText, formatDate, tokenFromUrl, showError, safeHttpsUrl } from './platform.js';
let timer;
(async () => {
  const token = tokenFromUrl();
  const { event } = await call('getInvitation', { token });
  $('invitationPage').hidden = false;
  document.querySelectorAll('[data-honorees]').forEach((n) => (n.textContent = event.honorees));
  setText('invitation-date', formatDate(event.eventDate));
  setText('invitation-time', `${event.eventTime} بتوقيت الرياض`);
  setText('invitation-venue', `${event.venueName}، ${event.city}`);
  setText('invitation-message', event.invitationMessage || 'يسرنا حضوركم ومشاركتكم هذه المناسبة.');
  setText('invitation-child-policy', event.childPolicy || '');
  const map = safeHttpsUrl(event.mapUrl);
  if (map) $('invitation-map').href = map;
  else $('invitation-map').hidden = true;
  $('rsvp-link').href = `rsvp.html#${new URLSearchParams({ token })}`;
  function update() {
    const remaining = Math.max(0, event.eventAt - Date.now());
    const values = {
      days: Math.floor(remaining / 86400000),
      hours: Math.floor((remaining % 86400000) / 3600000),
      minutes: Math.floor((remaining % 3600000) / 60000),
      seconds: Math.floor((remaining % 60000) / 1000),
    };
    Object.entries(values).forEach(([id, value]) => setText(id, String(value).padStart(2, '0')));
    if (!remaining) clearInterval(timer);
  }
  update();
  timer = setInterval(update, 1000);
})().catch(showError);
addEventListener('pagehide', () => clearInterval(timer));
