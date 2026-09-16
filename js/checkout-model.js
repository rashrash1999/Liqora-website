// Presentation only: never authorizes a charge. Prices and payment state come from the server.
const integer = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000;
function millis(value) {
  if (Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return NaN;
}
export const ADDON_LABELS = Object.freeze({
  gendered: 'نسختان للرجال والنساء',
  video: 'فيديو بنفس الثيم',
  social: 'نسخة للنشر العام',
});
export function readPricing(pricing, now = Date.now()) {
  if (
    !pricing ||
    pricing.currency !== 'SAR' ||
    pricing.status !== 'approved' ||
    !Array.isArray(pricing.items) ||
    !pricing.items.length ||
    pricing.items.length > 12
  )
    return null;
  if (
    !pricing.items.every(
      (item) =>
        typeof item.label === 'string' &&
        item.label.trim().length > 0 &&
        item.label.length <= 120 &&
        integer(item.amountHalalas),
    )
  )
    return null;
  const subtotal = pricing.items.reduce((sum, item) => sum + item.amountHalalas, 0);
  if (
    ![subtotal, pricing.discountHalalas, pricing.taxHalalas, pricing.totalHalalas].every(integer) ||
    pricing.discountHalalas > subtotal ||
    subtotal - pricing.discountHalalas + pricing.taxHalalas !== pricing.totalHalalas
  )
    return null;
  const expiresAt = millis(pricing.expiresAt);
  return {
    ...pricing,
    subtotalHalalas: subtotal,
    expiresAt,
    expired: !Number.isFinite(expiresAt) || expiresAt <= now,
  };
}
export function checkoutModel(order, now = Date.now()) {
  const pricing = readPricing(order.pricing, now);
  const states = {
    unpaid: [
      'saved',
      'طلبك محفوظ',
      'بانتظار استكمال الدفع',
      'ستظهر تفاصيل المبلغ النهائي هنا بعد اعتمادها. الدفع الإلكتروني غير متاح حاليًا.',
    ],
    pending: [
      'pending',
      'نتحقق من عملية الدفع',
      'الدفع قيد التحقق',
      'انتظر تأكيد العملية من مزوّد الدفع. حدّث الحالة قبل بدء أي محاولة أخرى.',
    ],
    processing: [
      'pending',
      'نتحقق من عملية الدفع',
      'الدفع قيد المعالجة',
      'حالة الطلب لم تُحسم بعد. لا تبدأ محاولة دفع أخرى قبل تحديث الحالة.',
    ],
    paid: [
      'paid',
      'تم تأكيد الدفع',
      'مدفوع',
      'يمكنك متابعة التصميم وقائمة الضيوف من لوحة مناسبتك.',
    ],
    failed: [
      'failed',
      'لم تكتمل عملية الدفع',
      'الدفع غير مكتمل',
      'لم يسجّل النظام عملية ناجحة. إذا ظهر خصم في حسابك، تواصل معنا برقم الطلب قبل إعادة المحاولة.',
    ],
    cancelled: [
      'cancelled',
      'أُلغيت عملية الدفع',
      'عملية الدفع ملغاة',
      'يمكنك مراجعة طلبك مع فريق medad Al tahaya قبل بدء عملية جديدة.',
    ],
    refunded: [
      'refunded',
      'تم تسجيل الاسترداد',
      'مسترد',
      'سجّل النظام استرداد الدفعة. ظهور المبلغ في حسابك يعتمد على مزوّد الدفع والبنك.',
    ],
    partially_refunded: [
      'refunded',
      'تم تسجيل استرداد جزئي',
      'مسترد جزئيًا',
      'راجع فريق medad Al tahaya لمعرفة تفاصيل المبلغ المسترد والمتبقي.',
    ],
  };
  let state = states[order.paymentStatus] || [
    'review',
    'نراجع حالة الطلب',
    'تحتاج الحالة إلى مراجعة',
    'تعذر تحديد حالة الدفع. حدّث الصفحة أو تواصل معنا برقم الطلب.',
  ];
  if (order.paymentStatus === 'unpaid') {
    if (order.status === 'cancelled') state = states.cancelled;
    else if (Number.isFinite(order.eventAt) && order.eventAt <= now)
      state = [
        'expired',
        'تجاوز الطلب موعد المناسبة',
        'انتهى موعد المناسبة',
        'تواصل معنا لمراجعة موعد المناسبة قبل متابعة الطلب.',
      ];
    else if (order.quoteRequired && (!pricing || pricing.expired))
      state = [
        'quote',
        'نجهّز عرض سعر يناسبك',
        'بانتظار عرض السعر',
        'الإضافات أو التصميم المخصص تحتاج تسعيرًا واعتمادًا قبل الدفع. المبلغ المبدئي ليس الإجمالي النهائي.',
      ];
    else if (pricing?.expired)
      state = [
        'expired',
        'عرض السعر يحتاج تحديثًا',
        'انتهت صلاحية العرض',
        'تواصل معنا للحصول على عرض سعر محدث قبل الدفع.',
      ];
  }
  return {
    state: state[0],
    title: state[1],
    label: state[2],
    message: state[3],
    pricing,
    baseAmountHalalas: integer(order.baseAmountHalalas) ? order.baseAmountHalalas : null,
    addons: Array.isArray(order.addons)
      ? order.addons.map((id) => ADDON_LABELS[id] || 'إضافة تحتاج مراجعة')
      : [],
    amountLabel: order.paymentStatus === 'paid' ? 'إجمالي العرض المعتمد' : 'الإجمالي النهائي',
    finalAmountHalalas: pricing ? pricing.totalHalalas : null,
    paidAmountHalalas:
      order.paymentStatus === 'paid' && integer(order.paidAmountHalalas)
        ? order.paidAmountHalalas
        : null,
    // A selected provider and a verified server-created session are still required.
    paymentEnabled: false,
  };
}
