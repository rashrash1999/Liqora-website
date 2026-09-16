import { requireUser, authFailure } from './auth.js';
import { getOrder } from './firebase-client.js';
import { checkoutModel } from './checkout-model.js';
import {
  $,
  PACKAGES,
  CONFIG,
  setText,
  formatMoney,
  formatDate,
  storageGet,
  storageRemove,
  showError,
  busy,
} from './platform.js';
let orderId,
  loading = false,
  sessionReady = false;
const money = (value) => (value == null ? 'لم يُعتمد بعد' : formatMoney(value / 100));
function row(label, value) {
  const item = document.createElement('li'),
    name = document.createElement('span'),
    amount = document.createElement('strong');
  name.textContent = label;
  amount.textContent = value;
  item.append(name, amount);
  return item;
}
function render(order) {
  const model = checkoutModel(order);
  $('checkout-skeleton').hidden = true;
  $('checkout-content').hidden = false;
  $('checkout-content').dataset.state = model.state;
  const values = {
    'checkout-title': model.title,
    'checkout-status': model.label,
    'payment-notice': model.message,
    'checkout-order-id': order.id,
    'checkout-package': PACKAGES[order.packageId]?.name || 'باقة تحتاج مراجعة',
    'checkout-event': `${order.occasion} · ${order.honorees}`,
    'checkout-owner': order.ownerName,
    'checkout-date': `${formatDate(order.eventDate)}، ${order.eventTime || ''} بتوقيت الرياض`,
    'checkout-venue': `${order.venueName}، ${order.city}`,
    'checkout-guests': `${order.expectedGuests} دعوة`,
    'checkout-total': money(model.finalAmountHalalas),
    'checkout-total-label': model.amountLabel,
    'checkout-paid': money(model.paidAmountHalalas),
    'price-note': model.pricing
      ? model.pricing.expired
        ? 'العرض المعروض منتهي الصلاحية. يلزم تحديثه قبل أي دفع جديد.'
        : 'تفاصيل العرض المعتمد محفوظة في الطلب.'
      : 'قيمة الباقة مرجعية. تُحدَّد الإضافات وأي ضريبة منطبقة في العرض النهائي؛ لا تُحتسب هنا على أنها صفر.',
  };
  Object.entries(values).forEach(([id, value]) => setText(id, value));
  $('paid-row').hidden = order.paymentStatus !== 'paid';
  $('checkout-lines').replaceChildren(
    ...(model.pricing
      ? [
          ...model.pricing.items.map((item) => row(item.label, money(item.amountHalalas))),
          row('الخصم', money(model.pricing.discountHalalas)),
          row('الضريبة بحسب العرض', money(model.pricing.taxHalalas)),
        ]
      : [
          row('قيمة الباقة المبدئية', money(model.baseAmountHalalas)),
          ...model.addons.map((label) => row(label, 'بانتظار التسعير')),
        ]),
  );
  $('checkout-addons').textContent = model.addons.length
    ? model.addons.join('، ')
    : 'لم تطلب إضافات';
  $('dashboard-link').href = `dashboard.html?order=${encodeURIComponent(order.id)}`;
  const support = new URL(`https://wa.me/${CONFIG.whatsappNumber}`);
  support.searchParams.set('text', `مرحبًا medad Al tahaya، أحتاج المساعدة بشأن الطلب ${order.id}`);
  $('checkout-support').href = support.href;
  $('payment-action').hidden = [
    'paid',
    'pending',
    'refunded',
    'cancelled',
    'expired',
    'review',
  ].includes(model.state);
  $('payment-action').disabled = true;
  $('payment-action').textContent =
    model.state === 'quote' ? 'بانتظار اعتماد عرض السعر' : 'الدفع الإلكتروني غير متاح حاليًا';
  $('step-payment').classList.toggle('is-complete', order.paymentStatus === 'paid');
  $('step-payment').setAttribute('aria-current', order.paymentStatus === 'paid' ? 'false' : 'step');
  setText(
    'checkout-updated',
    `آخر تحقق: ${new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())}`,
  );
}
async function refresh() {
  if (!sessionReady || loading) return;
  loading = true;
  $('page-error').hidden = true;
  $('checkout-stale').hidden = true;
  try {
    render(await getOrder(orderId, { fresh: true }));
  } catch (error) {
    if (['permission-denied', 'not-found'].includes(error.code)) {
      $('checkout-content').hidden = true;
    }
    $('checkout-skeleton').hidden = true;
    $('checkout-stale').hidden = false;
    showError(error);
  } finally {
    loading = false;
  }
}
$('refresh-payment').addEventListener('click', () => busy($('refresh-payment'), refresh));
addEventListener('focus', () => {
  if (sessionReady) refresh();
});
(async () => {
  orderId = new URLSearchParams(location.search).get('order');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(orderId || '')) {
    $('checkout-skeleton').hidden = true;
    $('checkout-empty').hidden = false;
    $('refresh-payment').hidden = true;
    return;
  }
  if (!(await requireUser())) return;
  sessionReady = true;
  await refresh();
  const notice = storageGet('medad.notice');
  if (notice) {
    setText('upload-notice', notice);
    $('upload-notice').hidden = false;
    storageRemove('medad.notice');
  }
})().catch((error) => {
  $('checkout-skeleton').hidden = true;
  authFailure(error);
});
