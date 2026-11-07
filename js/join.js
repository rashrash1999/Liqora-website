import { call } from './firebase-client.js';
import { $, formatDate, safeHttpsUrl, setText, showError, tokenFromUrl } from './platform.js';

function renderEvent(record) {
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

  $('registration-unavailable').hidden = false;
  if (registration.mode === 'private') {
    setText('registration-unavailable-title', 'هذه المناسبة تستخدم روابط شخصية');
    setText(
      'registration-unavailable-message',
      'استخدم الرابط الشخصي الذي أرسله لك صاحب المناسبة لعرض دعوتك وتسجيل ردك.',
    );
    return;
  }
  setText('registration-unavailable-title', 'التسجيل العام متوقف مؤقتًا');
  setText(
    'registration-unavailable-message',
    'أوقفنا إدخال أرقام الجوال من الرابط العام إلى أن يكتمل ربط مزود تحقق مناسب. تواصل مع صاحب المناسبة للحصول على رابط شخصي.',
  );
}

(async () => {
  const token = tokenFromUrl();
  renderEvent(await call('getPublicEvent', { token }));
})().catch(showError);
