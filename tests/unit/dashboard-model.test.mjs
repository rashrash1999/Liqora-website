import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastOrder, splitOrders } from '../../js/dashboard-model.js';

const now = new Date('2026-09-27T08:00:00Z');

test('dashboard separates current and past customer orders', () => {
  const current = { id: 'current', status: 'active', eventDate: '2026-10-10' };
  const expired = { id: 'expired', status: 'active', eventDate: '2026-09-20' };
  const completed = { id: 'completed', status: 'completed', eventDate: '2026-10-20' };
  assert.equal(isPastOrder(current, now), false);
  assert.equal(isPastOrder(expired, now), true);
  assert.equal(isPastOrder(completed, now), true);
  assert.deepEqual(splitOrders([current, expired, completed], now), {
    current: [current],
    past: [expired, completed],
  });
});
