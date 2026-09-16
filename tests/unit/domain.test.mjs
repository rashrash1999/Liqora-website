import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeOrder,
  normalizeSaudiPhone,
  normalizeGuests,
  parseCsv,
  normalizeRsvp,
  eventTimestamp,
  assertReady,
  reminderTimestamp,
  csvCell,
  safeHttpsUrl,
} from '../../functions/lib/domain.js';
import { baseOrder, guestRows } from '../helpers/fixtures.mjs';
const now = Date.parse('2030-10-01T00:00:00Z'),
  phone = '+966500000001';
test('client and server share identical validation', async () =>
  assert.equal(
    await readFile('js/domain.js', 'utf8'),
    await readFile('functions/lib/domain.js', 'utf8'),
  ));
test('Arabic, Persian, local and international Saudi phones normalize', () => {
  for (const value of [
    '0500000001',
    '٠٥٠٠٠٠٠٠٠١',
    '۰۵۰۰۰۰۰۰۰۱',
    '00966500000001',
    '+966 50 000 0001',
  ])
    assert.equal(normalizeSaudiPhone(value), phone);
  assert.equal(normalizeSaudiPhone('abc0500000001'), '');
  assert.equal(normalizeSaudiPhone('05e0000001'), '');
});
test('server derives price and refuses forged authority fields', () => {
  const order = normalizeOrder(baseOrder(), phone, now);
  assert.equal(order.baseAmountHalalas, 19900);
  for (const field of ['paid', 'price', 'paymentStatus', 'ownerUid', 'status'])
    assert.throws(() => normalizeOrder({ ...baseOrder(), [field]: 'forged' }, phone, now));
});
test('ownership phone, consent and all required form fields are enforced', () => {
  assert.throws(() => normalizeOrder(baseOrder(), '+966500000002', now));
  assert.throws(() => normalizeOrder({ ...baseOrder(), termsAccepted: 'on' }, phone, now));
  for (const field of [
    'ownerName',
    'occasion',
    'honorees',
    'venueName',
    'city',
    'theme',
    'orientation',
    'designTone',
  ])
    assert.throws(() => normalizeOrder({ ...baseOrder(), [field]: '' }, phone, now), field);
});
test('package capacity and integer boundaries are enforced', () => {
  for (const expectedGuests of [0, 101, -1, 1.5, NaN, Infinity, '1e2', true])
    assert.throws(() => normalizeOrder({ ...baseOrder(), expectedGuests }, phone, now));
});
test('impossible dates, past events and invalid times are rejected', () => {
  assert.throws(() => eventTimestamp('2030-02-30', '20:00'));
  assert.throws(() => eventTimestamp('2030-10-12', '24:00'));
  assert.equal(eventTimestamp('2030-10-12', '20:00'), Date.parse('2030-10-12T17:00:00Z'));
  assert.throws(() => normalizeOrder(baseOrder(), phone, Date.parse('2030-10-13')));
});
test('URL schemes and credentials cannot become links', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'http://example.com',
    'https://u:p@example.com',
  ]) {
    assert.equal(safeHttpsUrl(url), '');
    assert.throws(() => normalizeOrder({ ...baseOrder(), mapUrl: url }, phone, now));
  }
});
test('CSV supports BOM, quoted commas, CRLF and embedded newlines', () => {
  const rows = parseCsv(
    '\uFEFFname,phone,card_type,max_companions,notes\r\n"ضيف, أول",0500000011,general,2,"سطر\nثان"',
  );
  assert.equal(rows[0].name, 'ضيف, أول');
  assert.equal(rows[0].notes, 'سطر\nثان');
});
test('invalid CSV structure and normalized duplicate phones are rejected', () => {
  assert.throws(() => parseCsv('name,phone\na,b'));
  assert.throws(() => parseCsv('name,phone,card_type,max_companions\n"unterminated'));
  const rows = guestRows();
  rows[1].phone = '+966500000011';
  assert.throws(() => normalizeGuests(rows, baseOrder()));
});
test('guest and RSVP companions never exceed invitation policy', () => {
  assert.throws(() => normalizeGuests([{ ...guestRows()[0], max_companions: 3 }], baseOrder()));
  for (const companions of [-1, 3, 1.5, 'Infinity'])
    assert.throws(() =>
      normalizeRsvp({ attendance: 'yes', guestName: 'ضيف', companions }, { companionsLimit: 2 }),
    );
  assert.equal(
    normalizeRsvp({ attendance: 'no', guestName: 'ضيف', companions: 99 }, { companionsLimit: 2 })
      .companions,
    0,
  );
  assert.throws(() =>
    normalizeRsvp({ attendance: 'maybe', guestName: 'ضيف' }, { companionsLimit: 2 }),
  );
});
test('CSV formula payloads are exported as text', () => {
  for (const value of ['=HYPERLINK("x")', '+966500000001', '  @SUM(A1)', '-10'])
    assert.ok(csvCell(value).startsWith('"\''));
});
test('activation requires paid order, matching design version and nonempty guest list', () => {
  const ready = {
    status: 'preparing',
    paymentStatus: 'paid',
    designStatus: 'approved',
    approvedDesignVersion: 'v1',
    designVersion: 'v1',
    guestCount: 2,
    expectedGuests: 2,
    eventAt: now + 86400000,
  };
  assert.doesNotThrow(() => assertReady(ready, now));
  for (const patch of [
    { paymentStatus: 'unpaid' },
    { approvedDesignVersion: 'v0' },
    { guestCount: 0 },
    { guestCount: 3 },
    { eventAt: now - 1 },
    { status: 'cancelled' },
    { status: 'completed' },
  ])
    assert.throws(() => assertReady({ ...ready, ...patch }, now));
});
test('reminders cannot be saved for a time that has passed', () => {
  assert.throws(() => reminderTimestamp({ eventAt: now + 3600000 }, 24, now));
  assert.throws(() => reminderTimestamp({ eventAt: now + 10 * 86400000 }, 12, now));
});
