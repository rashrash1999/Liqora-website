const API_BASE = 'https://api.moyasar.com/v1';
const INVOICE_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const STATUSES = new Set([
  'initiated',
  'paid',
  'failed',
  'refunded',
  'canceled',
  'on_hold',
  'expired',
  'voided',
]);

export class MoyasarError extends Error {
  constructor(message, code = 'unavailable', status = 0) {
    super(message);
    this.name = 'MoyasarError';
    this.code = code;
    this.status = status;
  }
}

function configuredSecret(value) {
  const key = typeof value === 'function' ? value() : value;
  if (typeof key !== 'string' || !/^sk_(?:test|live)_[A-Za-z0-9_-]{12,}$/.test(key)) {
    throw new MoyasarError('مفتاح Moyasar السري غير مهيأ.', 'failed-precondition');
  }
  return key;
}

function secureUrl(value, label, allowedHost) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      (allowedHost && url.hostname !== allowedHost)
    )
      throw new Error();
    return url.href;
  } catch {
    throw new MoyasarError(`${label} غير صالح.`, 'internal');
  }
}

function publicOrigin(value) {
  const url = new URL(secureUrl(value, 'نطاق الموقع'));
  if (url.pathname !== '/' || url.search || url.hash)
    throw new MoyasarError(
      'PUBLIC_SITE_ORIGIN يجب أن يكون نطاقًا دون مسار.',
      'failed-precondition',
    );
  return url.origin;
}

function integer(value, label, min = 0, max = 100_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new MoyasarError(`${label} غير صالح.`, 'internal');
  return value;
}

export function normalizeMoyasarInvoice(input) {
  if (!input || typeof input !== 'object' || !INVOICE_ID.test(input.id || ''))
    throw new MoyasarError('استجابة فاتورة Moyasar غير صالحة.', 'internal');
  if (!STATUSES.has(input.status) || input.currency !== 'SAR')
    throw new MoyasarError('حالة فاتورة Moyasar غير صالحة.', 'internal');

  const amount = integer(input.amount, 'مبلغ الفاتورة', 100);
  let checkoutUrl = null;
  if (input.url) checkoutUrl = secureUrl(input.url, 'رابط الدفع', 'checkout.moyasar.com');
  if (input.status === 'initiated' && !checkoutUrl)
    throw new MoyasarError('فاتورة Moyasar لا تحتوي رابط دفع.', 'internal');

  const payments = Array.isArray(input.payments) ? input.payments : [];
  const settled = [...payments]
    .reverse()
    .find((payment) => ['paid', 'captured', 'refunded'].includes(payment?.status));
  if (
    ['paid', 'refunded'].includes(input.status) &&
    (!settled || !INVOICE_ID.test(settled.id || ''))
  )
    throw new MoyasarError('الفاتورة المدفوعة لا تحتوي عملية مؤكدة.', 'internal');
  let refundedAmount = 0;
  if (settled) {
    const paymentAmount = integer(settled.amount, 'مبلغ عملية الدفع', 100);
    refundedAmount = integer(settled.refunded || 0, 'المبلغ المسترد');
    if (
      paymentAmount !== amount ||
      settled.currency !== input.currency ||
      (settled.invoice_id && settled.invoice_id !== input.id) ||
      refundedAmount > paymentAmount ||
      (input.status === 'refunded' && refundedAmount === 0)
    )
      throw new MoyasarError('عملية الدفع لا تطابق الفاتورة.', 'internal');
  }

  return Object.freeze({
    id: input.id,
    status: input.status,
    amount,
    currency: input.currency,
    checkoutUrl,
    expiredAt: Number.isFinite(Date.parse(input.expired_at)) ? Date.parse(input.expired_at) : null,
    providerCreatedAt: Number.isFinite(Date.parse(input.created_at))
      ? Date.parse(input.created_at)
      : null,
    providerUpdatedAt: Number.isFinite(Date.parse(input.updated_at))
      ? Date.parse(input.updated_at)
      : null,
    paymentId: settled?.id || null,
    refundedAmount,
  });
}

export function createMoyasarGateway({
  secretKey,
  siteOrigin,
  callbackUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  apiBase = API_BASE,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');

  async function request(path, { method = 'GET', body } = {}) {
    const key = configuredSecret(secretKey);
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal:
          typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch {
      throw new MoyasarError('تعذر الاتصال بمزود الدفع.', 'unavailable');
    }

    const text = await response.text();
    if (text.length > 1_000_000)
      throw new MoyasarError('استجابة مزود الدفع كبيرة بصورة غير متوقعة.', 'internal');
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new MoyasarError('تعذر قراءة استجابة مزود الدفع.', 'internal', response.status);
    }
    if (!response.ok) {
      const code =
        response.status >= 500 || response.status === 429 ? 'unavailable' : 'failed-precondition';
      throw new MoyasarError('رفض مزود الدفع العملية.', code, response.status);
    }
    return normalizeMoyasarInvoice(data);
  }

  return Object.freeze({
    async createInvoice({ orderId, attemptId, amount, currency, expiresAt }) {
      if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(orderId))
        throw new MoyasarError('معرف الطلب غير صالح.', 'internal');
      if (typeof attemptId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(attemptId))
        throw new MoyasarError('معرف محاولة الدفع غير صالح.', 'internal');
      integer(amount, 'مبلغ الفاتورة', 100);
      if (currency !== 'SAR') throw new MoyasarError('عملة الفاتورة غير مدعومة.', 'internal');
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
        throw new MoyasarError('صلاحية فاتورة الدفع غير صحيحة.', 'internal');

      const origin = publicOrigin(typeof siteOrigin === 'function' ? siteOrigin() : siteOrigin);
      const checkout = new URL('/checkout.html', origin);
      checkout.searchParams.set('order', orderId);
      checkout.searchParams.set('payment', 'success');
      const back = new URL('/checkout.html', origin);
      back.searchParams.set('order', orderId);
      back.searchParams.set('payment', 'back');

      return request('/invoices', {
        method: 'POST',
        body: {
          amount,
          currency,
          description: `medad Al tahaya — ${orderId}`,
          callback_url: secureUrl(
            typeof callbackUrl === 'function' ? callbackUrl() : callbackUrl,
            'رابط إشعار الدفع',
          ),
          success_url: checkout.href,
          back_url: back.href,
          expired_at: new Date(expiresAt).toISOString(),
          metadata: { order_id: orderId, attempt_id: attemptId },
        },
      });
    },
    async fetchInvoice(invoiceId) {
      if (!INVOICE_ID.test(invoiceId || ''))
        throw new MoyasarError('معرف فاتورة Moyasar غير صالح.', 'invalid-argument');
      return request(`/invoices/${encodeURIComponent(invoiceId)}`);
    },
  });
}

export const isMoyasarInvoiceId = (value) => INVOICE_ID.test(value || '');
