import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutModel, readPricing } from '../../js/checkout-model.js';
const now = 1_900_000_000_000;
const order = {
  paymentStatus: 'unpaid',
  status: 'pending_payment',
  baseAmountHalalas: 19900,
  eventAt: now + 86400000,
  quoteRequired: false,
  addons: [],
};
const pricing = {
  currency: 'SAR',
  status: 'approved',
  items: [
    { label: 'الباقة', amountHalalas: 19900 },
    { label: 'إضافة', amountHalalas: 10000 },
  ],
  discountHalalas: 1000,
  taxHalalas: 4335,
  totalHalalas: 33235,
  expiresAt: now + 3600000,
};
test('a package estimate never becomes a payable final total', () => {
  const model = checkoutModel(order, now);
  assert.equal(model.baseAmountHalalas, 19900);
  assert.equal(model.finalAmountHalalas, null);
  assert.equal(model.paymentEnabled, false);
  for (const amount of [undefined, null, -1, '19900', NaN, Infinity, 1.5])
    assert.equal(
      checkoutModel({ ...order, baseAmountHalalas: amount }, now).baseAmountHalalas,
      null,
    );
});
test('quoted additions, expired offers and passed events have distinct states', () => {
  assert.equal(
    checkoutModel({ ...order, quoteRequired: true, addons: ['video'] }, now).state,
    'quote',
  );
  assert.equal(
    checkoutModel({ ...order, pricing: { ...pricing, expiresAt: now - 1 } }, now).state,
    'expired',
  );
  assert.equal(checkoutModel({ ...order, eventAt: now - 1 }, now).state, 'expired');
  assert.equal(checkoutModel({ ...order, status: 'cancelled' }, now).state, 'cancelled');
});
test('final totals require valid currency, integers and matching arithmetic', () => {
  assert.equal(readPricing(pricing, now).totalHalalas, 33235);
  assert.equal(
    readPricing({ ...pricing, expiresAt: { seconds: (now + 3600000) / 1000 } }, now).expired,
    false,
  );
  for (const invalid of [
    null,
    { ...pricing, currency: 'USD' },
    { ...pricing, status: 'draft' },
    { ...pricing, totalHalalas: 19900 },
    { ...pricing, taxHalalas: -1 },
    { ...pricing, discountHalalas: 50000 },
    { ...pricing, items: [] },
    { ...pricing, items: [{ label: '', amountHalalas: 19900 }] },
  ])
    assert.equal(readPricing(invalid, now), null);
  assert.equal(checkoutModel({ ...order, pricing }, now).finalAmountHalalas, 33235);
});
test('processing, failed and refunded are never shown as paid', () => {
  for (const state of [
    'pending',
    'processing',
    'failed',
    'cancelled',
    'refunded',
    'partially_refunded',
    'unrecognized',
  ]) {
    const m = checkoutModel({ ...order, paymentStatus: state }, now);
    assert.notEqual(m.state, 'paid');
    assert.equal(m.paymentEnabled, false);
    assert.equal(m.paidAmountHalalas, null);
  }
  const paid = checkoutModel(
    { ...order, paymentStatus: 'paid', paidAmountHalalas: 33235, pricing },
    now,
  );
  assert.equal(paid.state, 'paid');
  assert.equal(paid.paidAmountHalalas, 33235);
  assert.equal(
    checkoutModel({ ...order, paymentStatus: 'paid' }, now).paidAmountHalalas,
    null,
    'do not invent a receipt amount from the package estimate',
  );
});
