import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMoyasarGateway,
  isMoyasarInvoiceId,
  normalizeMoyasarInvoice,
} from '../../functions/payment/moyasar.js';

const invoiceId = '11111111-1111-4111-8111-111111111111';
const paymentId = '22222222-2222-4222-8222-222222222222';
const future = Date.now() + 30 * 60_000;
function invoice(overrides = {}) {
  return {
    id: invoiceId,
    status: 'initiated',
    amount: 19900,
    currency: 'SAR',
    url: `https://checkout.moyasar.com/invoices/${invoiceId}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expired_at: new Date(future).toISOString(),
    payments: [],
    ...overrides,
  };
}

test('server creates a hosted invoice with Basic auth and controlled return URLs', async () => {
  const seen = [];
  const gateway = createMoyasarGateway({
    secretKey: 'sk_test_supersecret123456',
    siteOrigin: 'https://medadtahaya.com',
    callbackUrl: 'https://me-central2-project.cloudfunctions.net/callback?token=secret',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(invoice()), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const result = await gateway.createInvoice({
    orderId: 'order-test-123456789',
    attemptId: 'attempt-test-12345678',
    amount: 19900,
    currency: 'SAR',
    expiresAt: future,
  });
  assert.equal(result.checkoutUrl, `https://checkout.moyasar.com/invoices/${invoiceId}`);
  assert.equal(seen[0].url, 'https://api.moyasar.com/v1/invoices');
  assert.equal(
    seen[0].init.headers.authorization,
    `Basic ${Buffer.from('sk_test_supersecret123456:').toString('base64')}`,
  );
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.amount, 19900);
  assert.equal(body.currency, 'SAR');
  assert.deepEqual(body.metadata, {
    order_id: 'order-test-123456789',
    attempt_id: 'attempt-test-12345678',
  });
  assert.equal(
    body.success_url,
    'https://medadtahaya.com/checkout.html?order=order-test-123456789&payment=success',
  );
  assert.equal(
    body.back_url,
    'https://medadtahaya.com/checkout.html?order=order-test-123456789&payment=back',
  );
  assert.ok(!seen[0].init.body.includes('sk_test_'));
});

test('invoice fetch accepts payment only when provider response contains a paid payment', async () => {
  const gateway = createMoyasarGateway({
    secretKey: 'sk_test_supersecret123456',
    siteOrigin: 'https://medadtahaya.com',
    callbackUrl: 'https://example.com/callback',
    fetchImpl: async (url) => {
      assert.equal(url, `https://api.moyasar.com/v1/invoices/${invoiceId}`);
      return new Response(
        JSON.stringify(
          invoice({
            status: 'paid',
            url: null,
            payments: [
              {
                id: paymentId,
                status: 'paid',
                amount: 19900,
                currency: 'SAR',
                invoice_id: invoiceId,
                refunded: 0,
              },
            ],
          }),
        ),
      );
    },
  });
  const result = await gateway.fetchInvoice(invoiceId);
  assert.equal(result.status, 'paid');
  assert.equal(result.paymentId, paymentId);
  assert.throws(() => normalizeMoyasarInvoice(invoice({ status: 'paid', payments: [] })));
  assert.throws(() =>
    normalizeMoyasarInvoice(
      invoice({
        status: 'paid',
        payments: [{ id: paymentId, status: 'paid', amount: 100, currency: 'SAR', refunded: 0 }],
      }),
    ),
  );
});

test('gateway rejects bad identifiers, currency, checkout origins and provider errors', async () => {
  assert.equal(isMoyasarInvoiceId(invoiceId), true);
  assert.equal(isMoyasarInvoiceId('../invoice'), false);
  assert.throws(() => normalizeMoyasarInvoice(invoice({ currency: 'USD' })));
  assert.throws(() => normalizeMoyasarInvoice(invoice({ url: 'https://evil.example/pay' })));
  const gateway = createMoyasarGateway({
    secretKey: 'sk_test_supersecret123456',
    siteOrigin: 'https://medadtahaya.com',
    callbackUrl: 'https://example.com/callback',
    fetchImpl: async () => new Response('{"message":"denied"}', { status: 422 }),
  });
  await assert.rejects(gateway.fetchInvoice(invoiceId), (error) => error.status === 422);
});
