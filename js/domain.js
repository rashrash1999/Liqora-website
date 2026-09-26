// Shared, dependency-free validation; scripts/build.mjs copies it to js/domain.js.
export const PACKAGES = Object.freeze({
  basic: Object.freeze({
    id: 'basic',
    name: 'البطاقة الذكية',
    label: 'جاهزة وسريعة',
    price: 199,
    includedInvitations: 100,
    guestLimit: 250,
    extraBlock: 50,
    extraBlockPrice: 59,
    designMode: 'ready',
    description: 'ثلاثة قوالب جاهزة ورابط تسجيل وتقارير الحضور',
  }),
  advanced: Object.freeze({
    id: 'advanced',
    name: 'موقع المناسبة المميز',
    label: 'تصميم مخصص',
    price: 799,
    includedInvitations: 500,
    guestLimit: 2000,
    extraBlock: 100,
    extraBlockPrice: 149,
    designMode: 'custom',
    description: 'موقع دعوة مخصص ونسختان للرجال والنساء وتقارير موسعة',
  }),
  business: Object.freeze({
    id: 'business',
    name: 'مداد أعمال',
    label: 'للشركات والجهات',
    price: 2950,
    includedInvitations: 1000,
    guestLimit: 10000,
    extraBlock: 500,
    extraBlockPrice: 499,
    designMode: 'custom',
    manualQuote: true,
    description: 'هوية الجهة وصلاحيات متعددة وتقارير تشغيلية بعرض سعر',
  }),
});

export const ADDON_PRICES = Object.freeze({
  customDesign: 199,
  gendered: 99,
  video: 299,
  social: 49,
});
export class DomainError extends Error {
  constructor(message, code = 'invalid-argument') {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
export function demand(condition, message, code) {
  if (!condition) throw new DomainError(message, code);
}
export function digits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (c) =>
    String('٠١٢٣٤٥٦٧٨٩'.includes(c) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(c) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)),
  );
}
export function normalizeSaudiPhone(value) {
  const original = digits(value).trim();
  if (/[^\d+\s()-]/.test(original)) return '';
  const n = original.replace(/[\s()+-]/g, '').replace(/^00966/, '966');
  if (/^9665\d{8}$/.test(n)) return `+${n}`;
  if (/^05\d{8}$/.test(n)) return `+966${n.slice(1)}`;
  if (/^5\d{8}$/.test(n)) return `+966${n}`;
  return '';
}
export function textValue(value, label, max = 120, required = true) {
  demand(value == null || typeof value === 'string', `${label}: قيمة غير صحيحة.`);
  const result = (value ?? '')
    .trim()
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  demand(
    (!required || result.length > 0) && result.length <= max,
    `${label}: أدخل نصًا ${required ? 'غير فارغ و' : ''}لا يتجاوز ${max} حرفًا.`,
  );
  return result;
}
export function integer(value, label, min, max) {
  demand(
    typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(digits(value))),
    `${label}: أدخل عددًا صحيحًا.`,
  );
  const n = Number(typeof value === 'string' ? digits(value) : value);
  demand(
    Number.isSafeInteger(n) && n >= min && n <= max,
    `${label}: العدد المسموح من ${min} إلى ${max}.`,
  );
  return n;
}
export function safeHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
}
export function eventTimestamp(date, time) {
  demand(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date), 'تاريخ المناسبة غير صحيح.');
  demand(
    typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
    'وقت المناسبة غير صحيح.',
  );
  const at = Date.parse(`${date}T${time}:00+03:00`);
  demand(
    Number.isFinite(at) && new Date(at + 10800000).toISOString().slice(0, 16) === `${date}T${time}`,
    'تاريخ المناسبة غير موجود.',
  );
  return at;
}
const ORDER_FIELDS = new Set([
  'packageId',
  'ownerName',
  'phone',
  'organizationName',
  'organizationType',
  'contactEmail',
  'vatNumber',
  'occasion',
  'honorees',
  'eventDate',
  'eventTime',
  'venueName',
  'city',
  'mapUrl',
  'expectedGuests',
  'invitationLimit',
  'seatCapacity',
  'registrationMode',
  'reminderHours',
  'maxCompanions',
  'companionNamesRequired',
  'allowWaitlist',
  'childPolicy',
  'invitationMessage',
  'theme',
  'orientation',
  'preferredColors',
  'designTone',
  'customNotes',
  'addons',
  'termsAccepted',
]);

export function normalizeReminderHours(value) {
  const input = Array.isArray(value) ? value : [value];
  demand(input.length > 0 && input.length <= 3, 'اختر من موعد إلى ثلاثة مواعيد للتذكير.');
  const hours = [...new Set(input.map((item) => integer(item, 'التذكير', 24, 72)))].sort(
    (a, b) => b - a,
  );
  demand(
    hours.length === input.length && hours.every((hour) => [24, 48, 72].includes(hour)),
    'اختر التذكير قبل 24 أو 48 أو 72 ساعة دون تكرار.',
  );
  return hours;
}

export function normalizeEmail(value, required = false) {
  demand(value == null || typeof value === 'string', 'البريد الإلكتروني: قيمة غير صحيحة.');
  const email = String(value || '')
    .trim()
    .toLowerCase();
  demand(
    (!required && !email) ||
      (email.length <= 254 &&
        /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)),
    'أدخل بريدًا إلكترونيًا صحيحًا.',
  );
  return email;
}

export function calculateOrderPricing({ packageId, invitationLimit, theme, addons = [] }) {
  const pkg = Object.hasOwn(PACKAGES, packageId) ? PACKAGES[packageId] : null;
  demand(pkg, 'اختر باقة صحيحة.');
  const count = integer(invitationLimit, 'عدد الدعوات', 1, pkg.guestLimit);
  const items = [{ label: pkg.name, amountHalalas: pkg.price * 100 }];
  const extra = Math.max(0, count - pkg.includedInvitations);
  if (extra) {
    const blocks = Math.ceil(extra / pkg.extraBlock);
    items.push({
      label: `${blocks * pkg.extraBlock} دعوة إضافية`,
      amountHalalas: blocks * pkg.extraBlockPrice * 100,
    });
  }
  if (theme === 'custom' && pkg.designMode !== 'custom')
    items.push({ label: 'تصميم ثابت مخصص', amountHalalas: ADDON_PRICES.customDesign * 100 });
  if (addons.includes('gendered') && pkg.id === 'basic')
    items.push({ label: 'نسختان للرجال والنساء', amountHalalas: ADDON_PRICES.gendered * 100 });
  if (addons.includes('video'))
    items.push({ label: 'فيديو دعوة بسيط', amountHalalas: ADDON_PRICES.video * 100 });
  if (addons.includes('social'))
    items.push({ label: 'نسخة للنشر الاجتماعي', amountHalalas: ADDON_PRICES.social * 100 });
  return {
    items,
    subtotalHalalas: items.reduce((sum, item) => sum + item.amountHalalas, 0),
    currency: 'SAR',
  };
}

export function normalizeOrder(input, verifiedPhone, now = Date.now()) {
  demand(input && typeof input === 'object' && !Array.isArray(input), 'بيانات الطلب غير صحيحة.');
  demand(
    Object.keys(input).every((k) => ORDER_FIELDS.has(k)),
    'الطلب يحتوي حقولًا غير مسموحة.',
  );
  const pkg = Object.hasOwn(PACKAGES, input.packageId) ? PACKAGES[input.packageId] : null;
  demand(pkg, 'اختر باقة صحيحة.');
  const phone = normalizeSaudiPhone(input.phone);
  demand(
    phone && phone === normalizeSaudiPhone(verifiedPhone),
    'رقم الطلب يجب أن يطابق رقم الجوال الذي سجلت الدخول به.',
    'permission-denied',
  );
  demand(input.termsAccepted === true, 'الموافقة على الشروط وصحة البيانات مطلوبة.');
  const at = eventTimestamp(input.eventDate, input.eventTime);
  demand(at > now, 'يجب أن يكون موعد المناسبة في المستقبل بتوقيت الرياض.');
  const reminderHours = normalizeReminderHours(input.reminderHours);
  demand(
    reminderHours.every((hours) => at - hours * 3600000 > now),
    'اختر مواعيد تذكير لم تمضِ بعد، أو اجعل المناسبة أبعد زمنيًا.',
  );
  const addons = input.addons ?? [];
  demand(
    Array.isArray(addons) &&
      addons.length <= 3 &&
      new Set(addons).size === addons.length &&
      addons.every((x) => ['gendered', 'video', 'social'].includes(x)),
    'الإضافات غير صحيحة.',
  );
  const mapUrl = safeHttpsUrl(input.mapUrl);
  demand(mapUrl && mapUrl.length <= 2048, 'أدخل رابط خريطة آمنًا يبدأ بـ https://.');
  demand(
    ['classic', 'modern', 'floral', 'royal', 'custom'].includes(input.theme),
    'اختر ثيمًا صحيحًا.',
  );
  const maxCompanions = integer(input.maxCompanions ?? 0, 'عدد المرافقين', 0, 2);
  const invitationLimit = integer(
    input.invitationLimit ?? input.expectedGuests,
    'عدد الدعوات',
    1,
    pkg.guestLimit,
  );
  const seatCapacity = integer(
    input.seatCapacity ?? invitationLimit,
    'السعة الفعلية',
    1,
    invitationLimit * (maxCompanions + 1),
  );
  demand(
    input.registrationMode === 'open' || input.registrationMode === 'private',
    'اختر رابط تسجيل مفتوحًا أو قائمة ضيوف خاصة.',
  );
  const customDesign = pkg.designMode === 'custom' || input.theme === 'custom';
  const business = pkg.id === 'business';
  const organizationType = textValue(input.organizationType, 'نوع الجهة', 40, business);
  if (organizationType)
    demand(
      ['company', 'government', 'nonprofit', 'agency', 'other'].includes(organizationType),
      'اختر نوع جهة صحيحًا.',
    );
  const vatNumber = digits(input.vatNumber || '').trim();
  demand(!vatNumber || /^3\d{13}3$/.test(vatNumber), 'الرقم الضريبي يجب أن يتكون من 15 رقمًا.');
  const automaticPricing = calculateOrderPricing({
    packageId: pkg.id,
    invitationLimit,
    theme: input.theme,
    addons,
  });
  return {
    packageId: pkg.id,
    ownerName: textValue(input.ownerName, 'اسم العميل', 100),
    phone,
    organizationName: textValue(input.organizationName, 'اسم الجهة', 160, business),
    organizationType,
    contactEmail: normalizeEmail(input.contactEmail, business),
    vatNumber,
    occasion: textValue(input.occasion, 'المناسبة', 80),
    honorees: textValue(input.honorees, 'الأسماء', 160),
    eventDate: input.eventDate,
    eventTime: input.eventTime,
    eventAt: at,
    venueName: textValue(input.venueName, 'المكان', 160),
    city: textValue(input.city, 'المدينة', 80),
    mapUrl,
    // expectedGuests is retained as a compatibility alias for older dashboards.
    expectedGuests: invitationLimit,
    invitationLimit,
    seatCapacity,
    registrationMode: input.registrationMode,
    maxCompanions,
    companionNamesRequired: input.companionNamesRequired !== false,
    allowWaitlist: input.allowWaitlist === true,
    reminderHours,
    childPolicy: textValue(input.childPolicy, 'سياسة الأطفال', 200, false),
    invitationMessage: textValue(input.invitationMessage, 'نص الدعوة', 700, false),
    theme: input.theme,
    orientation: textValue(input.orientation, 'اتجاه البطاقة', 30),
    designTone: textValue(input.designTone, 'طابع التصميم', 40),
    preferredColors: textValue(input.preferredColors, 'الألوان', 120, false),
    customNotes: textValue(input.customNotes, 'التصميم المخصص', 2000, customDesign),
    addons,
    termsAccepted: true,
    termsVersion: '2026-09-26',
    baseAmountHalalas: pkg.price * 100,
    automaticPricing,
    currency: 'SAR',
    quoteRequired: pkg.manualQuote === true,
    customDesign,
  };
}
export function normalizeGuests(rows, order) {
  demand(
    Array.isArray(rows) && rows.length > 0 && rows.length <= 200,
    'ارفع من 1 إلى 200 ضيف في الدفعة الواحدة.',
  );
  const seen = new Set();
  return rows.map((row, index) => {
    demand(row && typeof row === 'object', `السطر ${index + 2} غير صحيح.`);
    const phone = normalizeSaudiPhone(row.phone);
    demand(phone, `رقم الجوال في السطر ${index + 2} غير صحيح.`);
    demand(!seen.has(phone), `رقم مكرر في السطر ${index + 2}.`);
    seen.add(phone);
    const companionsLimit = integer(
      row.max_companions ?? 0,
      `المرافقون في السطر ${index + 2}`,
      0,
      order.maxCompanions,
    );
    const cardType = row.card_type || 'general';
    demand(
      ['male', 'female', 'general'].includes(cardType),
      `نوع البطاقة في السطر ${index + 2} غير صحيح.`,
    );
    return {
      displayName: textValue(row.name, `الاسم في السطر ${index + 2}`, 100),
      phone,
      companionsLimit,
      cardType,
    };
  });
}
export function normalizeRsvp(input, guest) {
  demand(input.attendance === 'yes' || input.attendance === 'no', 'حدد الحضور أو الاعتذار.');
  const companionNames = input.attendance === 'yes' ? (input.companionNames ?? []) : [];
  demand(Array.isArray(companionNames), 'أسماء المرافقين غير صحيحة.');
  demand(companionNames.length <= guest.companionsLimit, 'عدد المرافقين أكبر من المسموح.');
  const names = companionNames.map((name, index) =>
    textValue(name, `اسم المرافق ${index + 1}`, 100, guest.companionNamesRequired !== false),
  );
  return {
    attendance: input.attendance,
    guestName: textValue(input.guestName, 'اسم الضيف', 100),
    companions: names.length,
    companionNames: names,
    message: textValue(input.message, 'الرسالة', 300, false),
  };
}
export function assertReady(order, now = Date.now()) {
  demand(
    !['cancelled', 'completed'].includes(order.status),
    'الطلب ملغي أو منتهٍ ولا يمكن تفعيل دعواته.',
    'failed-precondition',
  );
  demand(
    order.paymentStatus === 'paid',
    'لم يتم تأكيد الدفع من مزود الدفع.',
    'failed-precondition',
  );
  demand(
    order.designStatus === 'approved' && order.approvedDesignVersion === order.designVersion,
    'يجب أن يعتمد العميل النسخة الحالية من التصميم.',
    'failed-precondition',
  );
  if (order.registrationMode === 'private')
    demand(
      order.guestCount > 0 && order.guestCount <= (order.invitationLimit || order.expectedGuests),
      'أضف قائمة المدعوين ضمن حد الباقة قبل النشر.',
      'failed-precondition',
    );
  else
    demand(
      (order.guestCount || 0) <= (order.invitationLimit || order.expectedGuests),
      'تجاوز عدد التسجيلات حد الباقة.',
      'failed-precondition',
    );
  demand(order.eventAt > now, 'انتهى موعد المناسبة.', 'failed-precondition');
}
export function reminderTimestamp(order, hours, now = Date.now()) {
  demand([24, 48, 72].includes(hours), 'موعد التذكير غير صحيح.');
  const at = order.eventAt - hours * 3600000;
  demand(at > now, 'موعد التذكير المختار مضى؛ اختر موعدًا أقرب للمناسبة.');
  return at;
}
export function parseCsv(source) {
  demand(typeof source === 'string' && source.length <= 2 * 1024 * 1024, 'ملف CSV أكبر من 2MB.');
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    closed = false;
  const input = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      closed = false;
      if (c !== ',') {
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
        if (c === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else {
      demand(!closed && c !== '"', 'تنسيق علامات الاقتباس في CSV غير صحيح.');
      field += c;
    }
    demand(rows.length <= 10000, 'ملف الضيوف يتجاوز 10000 سطر.');
  }
  demand(!quoted, 'علامة اقتباس غير مغلقة في CSV.');
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  demand(rows.length >= 2, 'الملف فارغ أو لا يحتوي ضيوفًا.');
  const header = rows.shift().map((x) => x.trim());
  demand(
    new Set(header).size === header.length &&
      ['name', 'phone', 'card_type', 'max_companions'].every((k) => header.includes(k)),
    'استخدم قالب CSV المرفق بعناوينه الأصلية.',
  );
  return rows.map((values, index) => {
    demand(values.length === header.length, `عدد الأعمدة غير صحيح في السطر ${index + 2}.`);
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  });
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
