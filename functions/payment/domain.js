import { demand, integer, textValue } from '../lib/domain.js';

const MAX_AMOUNT = 100_000_000;

function millis(value) {
  if (Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return NaN;
}

function money(value, label, min = 0) {
  return integer(value, label, min, MAX_AMOUNT);
}

export function readApprovedPricing(pricing, now = Date.now()) {
  if (
    !pricing ||
    pricing.currency !== 'SAR' ||
    pricing.status !== 'approved' ||
    !Array.isArray(pricing.items) ||
    !pricing.items.length ||
    pricing.items.length > 12
  )
    return null;
  try {
    const items = pricing.items.map((item) => ({
      label: textValue(item?.label, 'بند السعر', 120),
      amountHalalas: money(item?.amountHalalas, 'قيمة بند السعر'),
    }));
    const subtotalHalalas = items.reduce((sum, item) => sum + item.amountHalalas, 0);
    const discountHalalas = money(pricing.discountHalalas, 'الخصم');
    const taxHalalas = money(pricing.taxHalalas, 'الضريبة');
    const totalHalalas = money(pricing.totalHalalas, 'الإجمالي', 100);
    const expiresAt = millis(pricing.expiresAt);
    if (
      subtotalHalalas > MAX_AMOUNT ||
      discountHalalas > subtotalHalalas ||
      subtotalHalalas - discountHalalas + taxHalalas !== totalHalalas ||
      !Number.isFinite(expiresAt)
    )
      return null;
    return {
      ...pricing,
      items,
      subtotalHalalas,
      discountHalalas,
      taxHalalas,
      totalHalalas,
      expiresAt,
      expired: expiresAt <= now,
    };
  } catch {
    return null;
  }
}

export function payablePricing(order, now = Date.now()) {
  const pricing = readApprovedPricing(order?.pricing, now);
  demand(
    pricing && !pricing.expired,
    'بانتظار اعتماد عرض سعر صالح قبل الدفع.',
    'failed-precondition',
  );
  demand(order.currency === 'SAR', 'عملة الطلب غير مدعومة.', 'failed-precondition');
  demand(order.eventAt > now, 'انتهى موعد المناسبة.', 'failed-precondition');
  demand(
    !['paid', 'active', 'cancelled', 'completed'].includes(order.status),
    'لا يمكن بدء دفع لهذا الطلب.',
    'failed-precondition',
  );
  return pricing;
}

export function normalizePricingApproval(input, order, now = Date.now()) {
  demand(input && typeof input === 'object', 'بيانات عرض السعر غير صحيحة.');
  const additionalAmountHalalas = money(
    input.additionalAmountHalalas ?? 0,
    'قيمة التخصيص والإضافات',
  );
  const discountHalalas = money(input.discountHalalas ?? 0, 'الخصم');
  const taxHalalas = money(input.taxHalalas ?? 0, 'الضريبة');
  const expiresAt = millis(input.expiresAt);
  demand(
    Number.isFinite(expiresAt) && expiresAt >= now + 5 * 60_000 && expiresAt <= order.eventAt,
    'صلاحية العرض يجب أن تبدأ بعد خمس دقائق وتنتهي قبل المناسبة.',
  );
  const automaticItems = Array.isArray(order.automaticPricing?.items)
    ? order.automaticPricing.items.map((item) => ({
        label: textValue(item?.label, 'بند السعر', 120),
        amountHalalas: money(item?.amountHalalas, 'قيمة بند السعر'),
      }))
    : [
        {
          label: 'الباقة الأساسية للطلب',
          amountHalalas: money(order.baseAmountHalalas, 'سعر الباقة', 100),
        },
      ];
  demand(
    automaticItems.length > 0 && automaticItems.length <= 10,
    'بنود التسعير التلقائي غير صالحة.',
  );
  const automaticAmountHalalas = automaticItems.reduce((sum, item) => sum + item.amountHalalas, 0);
  const items = [
    ...automaticItems,
    ...(additionalAmountHalalas
      ? [{ label: 'التخصيص والإضافات', amountHalalas: additionalAmountHalalas }]
      : []),
  ];
  const subtotalHalalas = automaticAmountHalalas + additionalAmountHalalas;
  demand(discountHalalas <= subtotalHalalas, 'الخصم لا يمكن أن يتجاوز المجموع.');
  const totalHalalas = subtotalHalalas - discountHalalas + taxHalalas;
  demand(totalHalalas >= 100 && totalHalalas <= MAX_AMOUNT, 'الإجمالي النهائي غير صالح.');
  return {
    status: 'approved',
    currency: 'SAR',
    items,
    discountHalalas,
    taxHalalas,
    totalHalalas,
    expiresAt,
  };
}

export function internalPaymentStatus(providerStatus) {
  return (
    {
      initiated: 'pending',
      on_hold: 'processing',
      paid: 'paid',
      failed: 'failed',
      expired: 'failed',
      canceled: 'cancelled',
      voided: 'cancelled',
      refunded: 'refunded',
    }[providerStatus] || 'processing'
  );
}
