import { requireUser, authFailure } from './auth.js';
import { call } from './firebase-client.js';
import { $, setText, showError, busy } from './platform.js';
let verified = null,
  stream,
  scanTimer,
  epoch = 0;
function invalidate() {
  epoch++;
  verified = null;
  $('guestResult').hidden = true;
  $('checkinButton').disabled = true;
}
$('tokenInput').addEventListener('input', invalidate);
$('gate-order').addEventListener('change', invalidate);
async function verify() {
  const orderId = $('gate-order').value,
    token = $('tokenInput').value.trim();
  invalidate();
  const generation = epoch;
  const result = await call('verifyTicket', { orderId, token });
  if (generation !== epoch) return;
  verified = { orderId, token };
  $('guestResult').hidden = false;
  setText('gate-guest', result.displayName);
  setText('gate-companions', result.companions);
  setText('guestStatus', result.checkedIn ? 'تم الدخول مسبقًا' : 'بطاقة صالحة');
  $('checkinButton').disabled = result.checkedIn;
}
$('verifyButton').addEventListener('click', () =>
  busy($('verifyButton'), () => verify().catch(showError)),
);
$('checkinButton').addEventListener('click', () =>
  busy($('checkinButton'), async () => {
    try {
      if (!verified) return;
      const request = { ...verified, requestId: crypto.randomUUID() };
      const result = await call('checkInTicket', request);
      setText('guestStatus', result.alreadyCheckedIn ? 'تم الدخول مسبقًا' : 'تم تسجيل الدخول');
      verified = null;
    } catch (error) {
      showError(error);
    } finally {
      setTimeout(() => {
        $('checkinButton').disabled = true;
      }, 0);
    }
  }),
);
function stopCamera() {
  clearInterval(scanTimer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  $('camera').hidden = true;
  $('stop-camera').hidden = true;
}
$('start-camera').addEventListener('click', () =>
  busy($('start-camera'), async () => {
    try {
      if (!('BarcodeDetector' in window))
        throw new Error(
          'المسح بالكاميرا غير مدعوم في هذا المتصفح. استخدم قارئ QR أو أدخل الرمز يدويًا.',
        );
      stopCamera();
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      $('camera').srcObject = stream;
      $('camera').hidden = false;
      $('stop-camera').hidden = false;
      await $('camera').play();
      let scanning = false;
      scanTimer = setInterval(async () => {
        if (scanning) return;
        scanning = true;
        try {
          const results = await detector.detect($('camera'));
          if (results[0]) {
            $('tokenInput').value = results[0].rawValue;
            invalidate();
            stopCamera();
            await verify();
          }
        } catch (error) {
          showError(error);
          stopCamera();
        } finally {
          scanning = false;
        }
      }, 350);
    } catch (error) {
      showError(error);
      stopCamera();
    }
  }),
);
$('stop-camera').addEventListener('click', stopCamera);
(async () => {
  if (!(await requireUser('staff'))) return;
  const { orders } = await call('getGateAssignments');
  $('gate-order').replaceChildren(
    ...orders.map((o) => {
      const n = document.createElement('option');
      n.value = o.id;
      n.textContent = `${o.honorees} — ${o.id}`;
      return n;
    }),
  );
  const requested = new URLSearchParams(location.search).get('order');
  if (orders.some((o) => o.id === requested)) $('gate-order').value = requested;
  if (!orders.length) {
    $('verifyButton').disabled = true;
    $('start-camera').disabled = true;
    throw new Error('لا توجد مناسبات نشطة معيّنة لهذا الحساب.');
  }
})().catch(authFailure);
addEventListener('pagehide', stopCamera);
