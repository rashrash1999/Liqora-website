// Shared, dependency-free validation; scripts/build.mjs copies it to js/domain.js.
export const PACKAGES = Object.freeze({
  basic: Object.freeze({
    id: 'basic',
    name: 'الباقة الأساسية',
    label: 'جاهزة',
    price: 199,
    guestLimit: 100,
    description: 'قالب جاهز وتجهيز سريع',
  }),
  advanced: Object.freeze({
    id: 'advanced',
    name: 'الباقة المتقدمة',
    label: 'مميزة',
    price: 399,
    guestLimit: 500,
    description: 'تصاميم مميزة وإدارة أوسع',
  }),
  premium: Object.freeze({
    id: 'premium',
    name: 'الباقة المخصصة',
    label: 'خاصة',
    price: 699,
    guestLimit: 10000,
    description: 'تصميم خاص بعرض سعر معتمد',
  }),
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
  'occasion',
  'honorees',
  'eventDate',
  'eventTime',
  'venueName',
  'city',
  'mapUrl',
  'expectedGuests',
  'reminderHours',
  'maxCompanions',
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
  const reminderHours = integer(input.reminderHours, 'التذكير', 24, 72);
  demand([24, 48, 72].includes(reminderHours), 'اختر تذكيرًا قبل 24 أو 48 أو 72 ساعة.');
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
  return {
    packageId: pkg.id,
    ownerName: textValue(input.ownerName, 'اسم العميل', 100),
    phone,
    occasion: textValue(input.occasion, 'المناسبة', 80),
    honorees: textValue(input.honorees, 'الأسماء', 160),
    eventDate: input.eventDate,
    eventTime: input.eventTime,
    eventAt: at,
    venueName: textValue(input.venueName, 'المكان', 160),
    city: textValue(input.city, 'المدينة', 80),
    mapUrl,
    expectedGuests: integer(input.expectedGuests, 'عدد المدعوين', 1, pkg.guestLimit),
    maxCompanions: integer(input.maxCompanions ?? 0, 'عدد المرافقين', 0, 4),
    reminderHours,
    childPolicy: textValue(input.childPolicy, 'سياسة الأطفال', 200, false),
    invitationMessage: textValue(input.invitationMessage, 'نص الدعوة', 700, false),
    theme: input.theme,
    orientation: textValue(input.orientation, 'اتجاه البطاقة', 30),
    designTone: textValue(input.designTone, 'طابع التصميم', 40),
    preferredColors: textValue(input.preferredColors, 'الألوان', 120, false),
    customNotes: textValue(input.customNotes, 'التصميم المخصص', 2000, pkg.id === 'premium'),
    addons,
    termsAccepted: true,
    termsVersion: '2026-09-15',
    baseAmountHalalas: pkg.price * 100,
    currency: 'SAR',
    quoteRequired: pkg.id === 'premium' || addons.length > 0,
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
  return {
    attendance: input.attendance,
    guestName: textValue(input.guestName, 'اسم الضيف', 100),
    companions:
      input.attendance === 'yes'
        ? integer(input.companions ?? 0, 'المرافقون', 0, guest.companionsLimit)
        : 0,
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
  demand(
    order.guestCount > 0 && order.guestCount <= order.expectedGuests,
    'راجع قائمة المدعوين وحد الباقة.',
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
