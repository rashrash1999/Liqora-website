import { PACKAGES, normalizeSaudiPhone, digits, safeHttpsUrl, csvCell } from './domain.js';
export { PACKAGES, normalizeSaudiPhone, digits, safeHttpsUrl, csvCell };
export const CONFIG = Object.freeze({
  brandName: 'medad Al tahaya',
  whatsappNumber: '966537933514',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
});
export const STATUS_LABELS = Object.freeze({
  pending_payment: 'بانتظار الدفع',
  awaiting_quote: 'بانتظار عرض السعر',
  paid: 'تم الدفع',
  preparing: 'قيد التجهيز',
  ready: 'جاهز للمشاركة',
  active: 'الدعوات متاحة',
  completed: 'منتهٍ',
});
export const $ = (id) => document.getElementById(id);
export function setText(id, value) {
  const n = $(id);
  if (n) n.textContent = String(value ?? '—');
}
export function formatMoney(value) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(
    Number(value || 0),
  );
}
export function formatDate(value) {
  if (!value) return 'غير محدد';
  const d = new Date(typeof value === 'number' ? value : `${value}T12:00:00+03:00`);
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long', timeZone: 'Asia/Riyadh' }).format(d)
    : 'تاريخ غير صحيح';
}
export function storageGet(key, fallback = null) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) ?? fallback);
  } catch {
    return fallback;
  }
}
export function storageSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function storageRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
export function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'تعذر تسجيل الدخول. تحقق من بياناتك.',
    'auth/invalid-login-credentials': 'تعذر تسجيل الدخول. تحقق من بياناتك.',
    'auth/invalid-verification-code': 'رمز التحقق غير صحيح.',
    'auth/code-expired': 'انتهت صلاحية الرمز؛ اطلب رمزًا جديدًا.',
    'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
    'auth/network-request-failed': 'تعذر الاتصال. تحقق من اتصال الإنترنت.',
    'auth/invalid-phone-number': 'رقم الجوال غير صحيح.',
    'auth/operation-not-allowed': 'تسجيل الدخول بهذه الطريقة غير متاح حاليًا.',
    'auth/unauthorized-domain': 'تسجيل الدخول غير مفعّل على هذا النطاق. تواصل مع إدارة الموقع.',
    'auth/captcha-check-failed': 'أعد التحقق من أنك لست روبوتًا.',
    'functions/unauthenticated': 'انتهت الجلسة؛ سجّل الدخول مجددًا.',
    'permission-denied': 'ليس لديك صلاحية لعرض هذه البيانات.',
    'functions/internal': 'تعذر إتمام العملية؛ حاول لاحقًا.',
    'functions/unavailable': 'تعذر الاتصال بالخدمة؛ حاول لاحقًا.',
    unavailable: 'تعذر الاتصال بالخدمة؛ حاول لاحقًا.',
  };
  return messages[error?.code] || error?.message || 'تعذر إتمام العملية؛ حاول لاحقًا.';
}
export function showError(error, target = 'page-error') {
  let n = $(target);
  if (!n) {
    n = document.createElement('p');
    n.id = target;
    n.className = 'form-alert';
    n.setAttribute('role', 'alert');
    (document.querySelector('main') || document.body).prepend(n);
  }
  n.textContent = errorMessage(error);
  n.hidden = false;
}
export async function busy(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'جارٍ التنفيذ…';
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
export function safeReturn(value, fallback = 'dashboard.html') {
  try {
    const base = new URL('.', location.href),
      url = new URL(value || fallback, base);
    const pages = new Set([
      'order.html',
      'checkout.html',
      'dashboard.html',
      'admin.html',
      'checkin.html',
    ]);
    const file = url.pathname.slice(base.pathname.length);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) && pages.has(file)
      ? file + url.search
      : fallback;
  } catch {
    return fallback;
  }
}
export function tokenFromUrl() {
  const raw =
    new URLSearchParams(location.hash.slice(1)).get('token') ||
    new URLSearchParams(location.search).get('token');
  if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) {
    if (location.search.includes('token=')) {
      const u = new URL(location.href);
      u.searchParams.delete('token');
      u.hash = new URLSearchParams({ token: raw });
      history.replaceState(null, '', u);
    }
    return raw;
  }
  throw new Error('رابط الدعوة مفقود أو غير صالح. افتح الرابط الشخصي الذي وصلك.');
}
export function downloadCsv(filename, rows) {
  const data = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function clearLegacyDemo() {
  try {
    for (const key of Object.keys(localStorage))
      if (/^medad\.(auth\.|order\.|rsvp\.used\.|checkin\.)/.test(key)) localStorage.removeItem(key);
  } catch {}
}
clearLegacyDemo();
