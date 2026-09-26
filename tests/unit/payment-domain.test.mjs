import test from 'node:test';
import assert from 'node:assert/strict';
import {
  internalPaymentStatus,
  normalizePricingApproval,
  payablePricing,
  readApprovedPricing,
} from '../../functions/payment/domain.js';

const now = Date.parse('2030-10-01T00:00:00Z');
const order = {
  baseAmountHalalas: 19900,
  currency: 'SAR',
  eventAt: now + 10 * 86400000,
  status: 'awaiting_quote',
};

test('admin pricing is calculated in integer halalas and expires before the event', () => {
  const pricing = normalizePricingApproval(
    {
      additionalAmountHalalas: 10000,
      discountHalalas: 1000,
      taxHalalas: 4335,
      expiresAt: now + 86400000,
    },
    order,
    now,
  );
  assert.equal(pricing.totalHalalas, 33235);
  assert.equal(readApprovedPricing(pricing, now).subtotalHalalas, 29900);
  assert.equal(payablePricing({ ...order, pricing }, now).totalHalalas, 33235);
});

test('invalid, expired, forged and terminal pricing cannot become payable', () => {
  const pricing = normalizePricingApproval(
    { additionalAmountHalalas: 0, discountHalalas: 0, taxHalalas: 0, expiresAt: now + 3600000 },
    order,
    now,
  );
  assert.throws(() =>
    normalizePricingApproval(
      { ...pricing, discountHalalas: 999999, expiresAt: now + 3600000 },
      order,
      now,
    ),
  );
  assert.throws(() => normalizePricingApproval({ expiresAt: order.eventAt + 1 }, order, now));
  assert.throws(() => payablePricing({ ...order, pricing }, now + 3600001));
  assert.throws(() => payablePricing({ ...order, pricing, status: 'cancelled' }, now));
  assert.throws(() => payablePricing({ ...order, pricing, status: 'paid' }, now));
  assert.equal(readApprovedPricing({ ...pricing, totalHalalas: 1 }, now), null);
});

test('Moyasar states map to explicit internal states', () => {
  assert.equal(internalPaymentStatus('initiated'), 'pending');
  assert.equal(internalPaymentStatus('on_hold'), 'processing');
  assert.equal(internalPaymentStatus('paid'), 'paid');
  assert.equal(internalPaymentStatus('refunded'), 'refunded');
  assert.equal(internalPaymentStatus('voided'), 'cancelled');
});
