import { requireUser, authFailure } from './auth.js';
import { call, uploadFile } from './firebase-client.js';
import { normalizeOrder, calculateOrderPricing } from './domain.js';
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
  result.reminderHours = [...form.querySelectorAll('[name=reminderHours]:checked')].map((n) =>
    Number(n.value),
  );
  for (const name of ['invitationLimit', 'seatCapacity', 'maxCompanions'])
    result[name] = Number(result[name] || 0);
  result.companionNamesRequired = form.elements.companionNamesRequired.checked;
  result.allowWaitlist = form.elements.allowWaitlist.checked;
  result.termsAccepted = form.elements.termsAccepted.checked;
  return result;
}
function save() {
  if (user) storageSet(`medad.draft.${user.uid}`, { ...data(), termsAccepted: false });
}
function updateSummary() {
  const pkg = PACKAGES[form.elements.packageId.value],
    custom = pkg?.designMode === 'custom' || form.elements.theme.value === 'custom',
    business = pkg?.id === 'business';
  document.querySelectorAll('.business-fields').forEach((node) => {
    node.hidden = !business;
    node.querySelectorAll('input,select').forEach((field) => {
      field.disabled = !business;
      if (['organizationName', 'organizationType', 'contactEmail'].includes(field.name))
        field.required = business;
    });
  });
  document.querySelectorAll('.custom-design-fields').forEach((n) => {
    n.hidden = !custom;
    n.querySelectorAll('input,textarea').forEach((field) => {
      field.disabled = !custom;
    });
  });
  form.elements.customNotes.required = custom;
  const reminders = [...form.querySelectorAll('[name=reminderHours]:checked')].map(
      (node) => node.value,
    ),
    invitationLimit = Number(form.elements.invitationLimit.value || 0),
    seatCapacity = Number(form.elements.seatCapacity.value || 0),
    maxCompanions = Number(form.elements.maxCompanions.value || 0),
    addons = [...form.querySelectorAll('[name=addons]:checked')].map((node) => node.value);
  let pricing;
  try {
    if (pkg && invitationLimit)
      pricing = calculateOrderPricing({
        packageId: pkg.id,
        invitationLimit,
        theme: form.elements.theme.value || 'classic',
        addons,
      });
  } catch {}
  const labels = {
    'summary-label': pkg?.label || 'لم تختر باقة',
    'summary-name': pkg?.name || 'اختر باقتك',
    'summary-description': pkg?.description || '',
    'summary-limit': pkg ? `${invitationLimit || '—'} رقم · ${seatCapacity || '—'} مقعد` : '—',
    'summary-reminder': reminders.length ? reminders.map((x) => `${x}س`).join('، ') : '—',
    'summary-addons': addons.length ? `${addons.length} إضافات` : 'لا توجد',
    'summary-price': pricing
      ? formatMoney(pricing.subtotalHalalas / 100)
      : pkg
        ? formatMoney(pkg.price)
        : '—',
  };
  Object.entries(labels).forEach(([id, value]) => ($(id).textContent = value));
  form.elements.invitationLimit.max = String(pkg?.guestLimit || 10000);
  form.elements.invitationLimit.setCustomValidity(
    pkg && invitationLimit > pkg.guestLimit ? `حد هذه الباقة ${pkg.guestLimit} مدعو.` : '',
  );
  const maximumSeats = invitationLimit * (maxCompanions + 1);
  form.elements.seatCapacity.max = String(Math.max(1, maximumSeats || 30000));
  form.elements.seatCapacity.setCustomValidity(
    seatCapacity && maximumSeats && seatCapacity > maximumSeats
      ? `السعة القصوى وفق الدعوات والمرافقين هي ${maximumSeats} شخصًا.`
      : '',
  );
  const reminderInputs = [...form.querySelectorAll('[name=reminderHours]')];
  reminderInputs[0].setCustomValidity(reminders.length ? '' : 'اختر موعد تذكير واحدًا على الأقل.');
  form.elements.phone.setCustomValidity(
    normalizeSaudiPhone(form.elements.phone.value) ? '' : 'أدخل رقم جوال صحيحًا.',
  );
  const theme = form.elements.theme.value || 'classic';
  $('order-live-preview').className = `order-live-preview theme-${theme}`;
  $('live-occasion').textContent = form.elements.occasion.value || 'دعوة مناسبة';
  $('live-honorees').textContent = form.elements.honorees.value || 'أسماء أصحاب المناسبة';
  $('live-date').textContent =
    form.elements.eventDate.value && form.elements.eventTime.value
      ? `${formatDate(form.elements.eventDate.value)} · ${form.elements.eventTime.value}`
      : 'التاريخ والوقت';
  $('live-venue').textContent =
    [form.elements.venueName.value, form.elements.city.value].filter(Boolean).join('، ') ||
    'المكان';
}
function renderReview() {
  const d = data(),
    pkg = PACKAGES[d.packageId];
  const entries = [
    ['الباقة', pkg?.name],
    ['صاحب الطلب', d.ownerName],
    ['رقم الجوال', d.phone],
    ...(d.packageId === 'business'
      ? [
          ['الجهة', d.organizationName],
          ['نوع الجهة', d.organizationType],
          ['بريد العمل', d.contactEmail],
        ]
      : []),
    ['المناسبة', d.occasion],
    ['الأسماء', d.honorees],
    ['الموعد', `${formatDate(d.eventDate)} — ${d.eventTime}`],
    ['المكان', `${d.venueName}، ${d.city}`],
    ['أرقام الدعوات', d.invitationLimit],
    ['السعة الفعلية', d.seatCapacity],
    ['طريقة التسجيل', d.registrationMode === 'open' ? 'رابط مفتوح مع تحقق الجوال' : 'قائمة خاصة'],
    ['المرافقون لكل دعوة', d.maxCompanions],
    ['التذكيرات', d.reminderHours.map((hour) => `قبل ${hour} ساعة`).join('، ')],
    ['الإضافات', d.addons.length],
    [
      'المبلغ المحسوب',
      pkg
        ? formatMoney(
            calculateOrderPricing({
              packageId: pkg.id,
              invitationLimit: d.invitationLimit,
              theme: d.theme,
              addons: d.addons,
            }).subtotalHalalas / 100,
          )
        : '—',
    ],
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
      field.checked = Array.isArray(value)
        ? value.includes(Number(field.value) || field.value)
        : Boolean(value);
    else if (value != null) field.value = value;
  }
  form.elements.phone.value = user.phoneNumber;
  form.elements.phone.readOnly = true;
  if (!form.elements.ownerName.value && user.displayName)
    form.elements.ownerName.value = user.displayName;
  form.elements.termsAccepted.checked = false;
  form.elements.eventDate.min = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const params = new URLSearchParams(location.search);
  const guests = Number(params.get('guests'));
  if (Number.isInteger(guests) && guests >= 1 && guests <= 10000) {
    form.elements.invitationLimit.value = guests;
    form.elements.seatCapacity.value = guests;
  }
  const theme = params.get('theme');
  if (['classic', 'floral', 'modern', 'royal', 'custom'].includes(theme))
    form.elements.theme.value = theme;
  const pkg = params.get('package');
  if (Object.hasOwn(PACKAGES, pkg || ''))
    form.querySelector(`[name=packageId][value="${pkg}"]`).checked = true;
  if (!form.elements.registrationMode.value)
    form.querySelector('[name=registrationMode][value="open"]').checked = true;
  updateSummary();
  goToStep(1);
  next.disabled = false;
  submit.disabled = false;
})().catch(authFailure);
