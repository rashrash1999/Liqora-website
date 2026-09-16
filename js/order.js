import { requireUser, authFailure } from './auth.js';
import { call, uploadFile } from './firebase-client.js';
import { normalizeOrder } from './domain.js';
import {
  $,
  PACKAGES,
  formatMoney,
  formatDate,
  normalizeSaudiPhone,
  storageGet,
  storageSet,
  storageRemove,
  showError,
  busy,
} from './platform.js';
const form = $('order-form'),
  steps = [...form.querySelectorAll('.form-step')];
let currentStep = 1,
  user;
const next = $('next-step'),
  previous = $('previous-step'),
  submit = $('submit-order');
next.disabled = true;
submit.disabled = true;
function data() {
  const result = Object.fromEntries(new FormData(form));
  delete result.referenceFile;
  result.addons = [...form.querySelectorAll('[name=addons]:checked')].map((n) => n.value);
  for (const name of ['expectedGuests', 'reminderHours', 'maxCompanions'])
    result[name] = Number(result[name] || 0);
  result.termsAccepted = form.elements.termsAccepted.checked;
  return result;
}
function save() {
  if (user) storageSet(`medad.draft.${user.uid}`, { ...data(), termsAccepted: false });
}
function updateSummary() {
  const pkg = PACKAGES[form.elements.packageId.value],
    custom = pkg?.id === 'premium';
  document.querySelectorAll('.custom-design-fields').forEach((n) => {
    n.hidden = !custom;
    n.querySelectorAll('input,textarea').forEach((field) => {
      field.disabled = !custom;
    });
  });
  form.elements.customNotes.required = custom;
  const labels = {
    'summary-label': pkg?.label || 'لم تختر باقة',
    'summary-name': pkg?.name || 'اختر باقتك',
    'summary-description': pkg?.description || '',
    'summary-limit': pkg
      ? pkg.id === 'premium'
        ? 'حسب عرض السعر'
        : `حتى ${pkg.guestLimit} مدعو`
      : '—',
    'summary-reminder': form.elements.reminderHours.value
      ? `قبل ${form.elements.reminderHours.value} ساعة`
      : '—',
    'summary-addons': form.querySelectorAll('[name=addons]:checked').length
      ? 'تُسعّر في العرض النهائي'
      : 'لا توجد',
    'summary-price': pkg ? formatMoney(pkg.price) : '—',
  };
  Object.entries(labels).forEach(([id, value]) => ($(id).textContent = value));
  form.elements.expectedGuests.setCustomValidity(
    pkg && Number(form.elements.expectedGuests.value) > pkg.guestLimit
      ? `حد هذه الباقة ${pkg.guestLimit} مدعو.`
      : '',
  );
  form.elements.phone.setCustomValidity(
    normalizeSaudiPhone(form.elements.phone.value) ? '' : 'أدخل رقم جوال صحيحًا.',
  );
}
function renderReview() {
  const d = data(),
    pkg = PACKAGES[d.packageId];
  const entries = [
    ['الباقة', pkg?.name],
    ['صاحب الطلب', d.ownerName],
    ['رقم الجوال', d.phone],
    ['المناسبة', d.occasion],
    ['الأسماء', d.honorees],
    ['الموعد', `${formatDate(d.eventDate)} — ${d.eventTime}`],
    ['المكان', `${d.venueName}، ${d.city}`],
    ['عدد المدعوين', d.expectedGuests],
    ['المرافقون لكل دعوة', d.maxCompanions],
    ['التذكير', `قبل ${d.reminderHours} ساعة`],
    ['الإضافات', d.addons.length],
    ['المبلغ المبدئي', formatMoney(pkg?.price)],
  ];
  const nodes = entries.map(([label, value]) => {
    const n = document.createElement('div');
    n.className = 'review-item';
    const span = document.createElement('span'),
      strong = document.createElement('strong');
    span.textContent = label;
    strong.textContent = String(value ?? '—');
    n.append(span, strong);
    return n;
  });
  $('review-grid').replaceChildren(...nodes);
}
function goToStep(step) {
  currentStep = Math.max(1, Math.min(4, step));
  steps.forEach((n, i) => (n.hidden = i + 1 !== currentStep));
  document.querySelectorAll('[data-stepper]').forEach((n, i) => {
    n.classList.toggle('is-active', i + 1 === currentStep);
    n.classList.toggle('is-complete', i + 1 < currentStep);
    n.setAttribute('aria-current', i + 1 === currentStep ? 'step' : 'false');
    n.querySelector('b').textContent =
      i + 1 < currentStep ? '✓' : new Intl.NumberFormat('ar-SA').format(i + 1);
  });
  previous.hidden = currentStep === 1;
  next.hidden = currentStep === 4;
  submit.hidden = currentStep !== 4;
  if (currentStep === 4) renderReview();
  $('form-alert').hidden = true;
}
function validateStep(index) {
  updateSummary();
  const fields = [...steps[index - 1].querySelectorAll('input,select,textarea')].filter(
    (n) => !n.disabled,
  );
  const bad = fields.find((n) => !n.checkValidity());
  if (bad) {
    goToStep(index);
    bad.reportValidity();
    bad.focus();
    showError(new Error('راجع الحقول المطلوبة قبل المتابعة.'), 'form-alert');
    return false;
  }
  return true;
}
function forward() {
  if (validateStep(currentStep)) {
    save();
    goToStep(currentStep + 1);
  }
}
next.addEventListener('click', forward);
previous.addEventListener('click', () => goToStep(currentStep - 1));
form.addEventListener('change', () => {
  updateSummary();
  save();
});
form.addEventListener('input', () => {
  updateSummary();
  save();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!user) return;
  if (currentStep < 4) {
    forward();
    return;
  }
  for (let i = 1; i <= 4; i++) if (!validateStep(i)) return;
  busy(submit, async () => {
    try {
      const payload = data();
      normalizeOrder(payload, user.phoneNumber);
      const key = `medad.order.request.${user.uid}`;
      let pending = storageGet(key);
      const fingerprint = JSON.stringify(payload);
      if (!pending || pending.fingerprint !== fingerprint) {
        pending = { requestId: crypto.randomUUID(), fingerprint };
        storageSet(key, pending);
      }
      const created = await call('createOrder', { order: payload, requestId: pending.requestId });
      storageRemove(key);
      storageRemove(`medad.draft.${user.uid}`);
      const file = form.elements.referenceFile.disabled
        ? null
        : form.elements.referenceFile.files[0];
      if (file) {
        try {
          await uploadFile(created.id, file);
        } catch (error) {
          storageSet(
            'medad.notice',
            'تم حفظ الطلب، لكن الملف المرجعي لم يُرفع. يمكنك إعادة رفعه من لوحة المناسبة.',
          );
        }
      }
      location.assign(`checkout.html?order=${encodeURIComponent(created.id)}`);
    } catch (error) {
      showError(error, 'form-alert');
    }
  });
});
(async () => {
  const session = await requireUser();
  if (!session) return;
  user = session.user;
  const draft = storageGet(`medad.draft.${user.uid}`, {});
  for (const field of form.elements) {
    if (
      !field.name ||
      field.type === 'file' ||
      field.name === 'termsAccepted' ||
      !Object.hasOwn(draft, field.name)
    )
      continue;
    const value = draft[field.name];
    if (field.type === 'radio') field.checked = field.value === String(value);
    else if (field.type === 'checkbox')
      field.checked = Array.isArray(value) && value.includes(field.value);
    else if (value != null) field.value = value;
  }
  form.elements.phone.value = user.phoneNumber;
  form.elements.phone.readOnly = true;
  form.elements.termsAccepted.checked = false;
  form.elements.eventDate.min = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const params = new URLSearchParams(location.search);
  const guests = Number(params.get('guests'));
  if (Number.isInteger(guests) && guests >= 1 && guests <= 10000)
    form.elements.expectedGuests.value = guests;
  const theme = params.get('theme');
  if (['classic', 'floral', 'modern', 'royal'].includes(theme)) form.elements.theme.value = theme;
  const pkg = params.get('package');
  if (Object.hasOwn(PACKAGES, pkg || ''))
    form.querySelector(`[name=packageId][value="${pkg}"]`).checked = true;
  updateSummary();
  goToStep(1);
  next.disabled = false;
  submit.disabled = false;
})().catch(authFailure);
