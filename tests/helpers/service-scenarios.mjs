import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createService } from '../../functions/service.js';
import { baseOrder, guestRows, owner, other, admin, gate } from './fixtures.mjs';
export async function runScenarios(db) {
  let time = Date.parse('2030-10-01T00:00:00Z');
  const { handlers: h } = createService({
    db,
    clock: () => time,
    ticketKey: () => 'local-test-signing-key-32-characters-minimum',
    qrCode: async (p) => `data:image/png;base64,${Buffer.from(p).toString('base64')}`,
    verifyFile: async () => {},
  });
  const invoke = (name, auth, data) => h[name]({ auth, data, rawRequest: { ip: '127.0.0.1' } });
  const key = randomUUID();
  const created = await invoke('createOrder', owner, { requestId: key, order: baseOrder() });
  const id = created.id,
    ref = db.doc(`orders/${id}`);
  assert.equal((await invoke('createOrder', owner, { requestId: key, order: baseOrder() })).id, id);
  await assert.rejects(
    invoke('createOrder', owner, {
      requestId: key,
      order: { ...baseOrder(), ownerName: 'اسم مختلف' },
    }),
  );
  await assert.rejects(
    invoke('createOrder', null, { requestId: randomUUID(), order: baseOrder() }),
  );
  await assert.rejects(invoke('saveReminderPreference', other, { orderId: id, hours: 24 }));
  await ref.update({ status: 'cancelled' });
  await assert.rejects(invoke('saveReminderPreference', owner, { orderId: id, hours: 24 }));
  await assert.rejects(
    invoke('prepareUpload', owner, {
      orderId: id,
      kind: 'reference',
      contentType: 'image/png',
      size: 100,
    }),
  );
  await ref.update({ status: 'pending_payment' });
  await assert.rejects(invoke('createPaymentSession', owner, { orderId: id }));
  assert.equal((await ref.get()).data().paymentStatus, 'unpaid');
  await assert.rejects(invoke('importGuests', admin, { orderId: id, rows: guestRows() }));
  await assert.rejects(
    invoke('prepareUpload', other, {
      orderId: id,
      kind: 'reference',
      contentType: 'image/png',
      size: 100,
    }),
  );
  await assert.rejects(
    invoke('prepareUpload', owner, {
      orderId: id,
      kind: 'reference',
      contentType: 'image/svg+xml',
      size: 100,
    }),
  );
  for (let i = 0; i < 3; i++)
    await invoke('prepareUpload', owner, {
      orderId: id,
      kind: 'reference',
      contentType: 'image/png',
      size: 100,
    });
  await assert.rejects(
    invoke('prepareUpload', owner, {
      orderId: id,
      kind: 'reference',
      contentType: 'image/png',
      size: 100,
    }),
  );
  // Trusted payment and design fixture ONLY for tests. No client API marks an order paid.
  await ref.update({
    paymentStatus: 'paid',
    designStatus: 'awaiting_approval',
    designPath: 'fixture',
    designVersion: 'version1',
  });
  await assert.rejects(invoke('approveDesign', other, { orderId: id, version: 'version1' }));
  await assert.rejects(invoke('approveDesign', owner, { orderId: id, version: 'stale' }));
  await invoke('approveDesign', owner, { orderId: id, version: 'version1' });
  assert.equal(
    (await invoke('approveDesign', owner, { orderId: id, version: 'version1' })).replayed,
    true,
  );
  await ref.update({ status: 'completed' });
  await assert.rejects(invoke('approveDesign', owner, { orderId: id, version: 'version1' }));
  await ref.update({ status: 'pending_payment' });
  assert.equal((await invoke('importGuests', admin, { orderId: id, rows: guestRows() })).added, 2);
  assert.equal(
    (await invoke('importGuests', admin, { orderId: id, rows: guestRows() })).skipped,
    2,
  );
  await assert.rejects(
    invoke('importGuests', admin, {
      orderId: id,
      rows: [{ ...guestRows()[0], phone: '0500000099' }],
    }),
  );
  assert.equal((await ref.get()).data().guestCount, 2);
  const guestDocs = await ref.collection('guests').get();
  const guestIds = guestDocs.docs.map((d) => d.id);
  await assert.rejects(invoke('issueInvitations', owner, { orderId: id, guestIds }));
  const first = await invoke('issueInvitations', admin, { orderId: id, guestIds });
  const links = await invoke('issueInvitations', admin, { orderId: id, guestIds });
  await assert.rejects(invoke('getInvitation', null, { token: first.links[0].token }));
  await assert.rejects(invoke('getInvitation', null, { token: 'x'.repeat(43) }));
  await assert.rejects(invoke('importGuests', admin, { orderId: id, rows: guestRows() }));
  const token = links.links[0].token;
  const publicData = await invoke('getInvitation', null, { token });
  assert.ok(!JSON.stringify(publicData).includes(owner.token.phone_number));
  assert.equal(publicData.response, null);
  const input = {
    token,
    attendance: 'yes',
    guestName: 'ضيف اختبار',
    companions: 0,
    message: 'تهنئة',
    requestId: randomUUID(),
  };
  const attempts = await Promise.allSettled([
    invoke('submitRsvp', null, input),
    invoke('submitRsvp', null, { ...input, requestId: randomUUID() }),
  ]);
  assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await ref.get()).data().acceptedCount, 1);
  const response = await invoke('getInvitation', null, { token });
  assert.equal(response.response.attendance, 'yes');
  assert.ok(response.ticket.payload.startsWith('MEDAD1:'));
  // A repeat of the winning request is idempotent; the total never increments twice.
  if (attempts[0].status === 'fulfilled') await invoke('submitRsvp', null, input);
  assert.equal((await ref.get()).data().acceptedCount, 1);
  time = Date.parse('2030-10-12T15:00:00Z');
  const ticket = response.ticket.payload;
  await assert.rejects(invoke('verifyTicket', owner, { orderId: id, token: ticket }));
  await assert.rejects(invoke('verifyTicket', gate, { orderId: id, token: ticket }));
  await db.doc(`gateAssignments/${gate.uid}/orders/${id}`).set({ active: true });
  await assert.rejects(
    invoke('verifyTicket', gate, { orderId: 'other-order-12345678', token: ticket }),
  );
  assert.equal(
    (await invoke('verifyTicket', gate, { orderId: id, token: ticket })).checkedIn,
    false,
  );
  const gateResults = await Promise.all([
    invoke('checkInTicket', gate, { orderId: id, token: ticket, requestId: randomUUID() }),
    invoke('checkInTicket', gate, { orderId: id, token: ticket, requestId: randomUUID() }),
  ]);
  assert.equal(gateResults.filter((x) => x.alreadyCheckedIn).length, 1);
  assert.equal((await ref.get()).data().checkedInCount, 1);
  time = Date.parse('2030-10-13T00:00:00Z');
  await assert.rejects(invoke('getInvitation', null, { token }));
  await assert.rejects(invoke('verifyTicket', gate, { orderId: id, token: ticket }));
  return {
    orderId: id,
    checks:
      'ownership, server pricing, consent, idempotency, upload limits, approval, guest duplicates, token rotation, RSVP race, event assignment, check-in race and expiry',
  };
}
