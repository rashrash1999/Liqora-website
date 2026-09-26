// Presentation only: charging and payment confirmation remain server-authoritative.
const integer = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000;
function millis(value) {
  if (Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return NaN;
}
function moyasarCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'checkout.moyasar.com' &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
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
    pricing.totalHalalas < 100 ||
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
      'طلبك جاهز للدفع',
      'جاهز للدفع',
      'راجع بنود السعر، ثم انتقل إلى صفحة Moyasar الآمنة عندما تكون مستعدًا.',
    ],
    pending: [
      'pending',
      'أكمل عملية الدفع الآمنة',
      'فاتورة الدفع جاهزة',
      'استخدم زر متابعة الدفع للانتقال إلى صفحة Moyasar الآمنة. لا تُدخل بيانات البطاقة داخل موقعنا.',
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
      'أكد الخادم الفاتورة مباشرة من Moyasar. يمكنك متابعة التصميم وقائمة الضيوف.',
    ],
    failed: [
      'failed',
      'لم تكتمل عملية الدفع',
      'الدفع غير مكتمل',
      'لم يسجّل النظام عملية ناجحة. إذا ظهر خصم في حسابك، تواصل معنا قبل إعادة المحاولة.',
    ],
    cancelled: [
      'cancelled',
      'أُلغيت عملية الدفع',
      'عملية الدفع ملغاة',
      'يمكنك إنشاء محاولة جديدة ما دام عرض السعر صالحًا والطلب غير ملغي.',
    ],
    refunded: [
      'refunded',
      'تم تسجيل الاسترداد',
      'مسترد',
      'سجّل النظام استرداد الدفعة. ظهور المبلغ يعتمد على مزوّد الدفع والبنك.',
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
  const eventPassed = Number.isFinite(order.eventAt) && order.eventAt <= now;
  if (order.paymentStatus === 'unpaid') {
    if (order.status === 'cancelled') state = states.cancelled;
    else if (eventPassed)
      state = [
        'expired',
        'تجاوز الطلب موعد المناسبة',
        'انتهى موعد المناسبة',
        'تواصل معنا لمراجعة موعد المناسبة قبل متابعة الطلب.',
      ];
    else if (!pricing)
      state = [
        'quote',
        order.quoteRequired ? 'نجهّز عرض سعر يناسبك' : 'نراجع المبلغ النهائي',
        'بانتظار اعتماد السعر',
        'لن يُفتح الدفع قبل اعتماد مبلغ نهائي صالح من الإدارة.',
      ];
    else if (pricing.expired)
      state = [
        'expired',
        'عرض السعر يحتاج تحديثًا',
        'انتهت صلاحية العرض',
        'تواصل معنا للحصول على عرض سعر محدث قبل الدفع.',
      ];
  }

  const sessionUrl = moyasarCheckoutUrl(order.paymentSession?.checkoutUrl);
  const sessionExpiresAt = millis(order.paymentSession?.expiresAt);
  let paymentAction = null;
  if (
    ['pending', 'processing'].includes(order.paymentStatus) &&
    sessionUrl &&
    sessionExpiresAt > now
  ) {
    paymentAction = {
      type: 'resume',
      label: 'متابعة الدفع الآمن عبر Moyasar',
      url: sessionUrl,
    };
  } else if (
    ['unpaid', 'failed', 'cancelled'].includes(order.paymentStatus) &&
    pricing &&
    !pricing.expired &&
    !eventPassed &&
    !['paid', 'active', 'cancelled', 'completed'].includes(order.status)
  ) {
    paymentAction = {
      type: 'create',
      label: 'الانتقال إلى الدفع الآمن',
      url: null,
    };
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
    paymentAction,
    paymentEnabled: Boolean(paymentAction),
  };
}
