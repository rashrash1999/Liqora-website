import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createService } from '../../functions/service.js';
import { baseOrder, guestRows, owner, other, admin, gate } from './fixtures.mjs';
export async function runScenarios(db) {
  let time = Date.parse('2030-10-01T00:00:00Z');
  let createdInvoices = 0;
  const sentMessages = [];
  let providerInvoice;
  const invoiceId = '11111111-1111-4111-8111-111111111111';
  const paymentGateway = {
    async createInvoice(input) {
      createdInvoices++;
      providerInvoice = {
        id: invoiceId,
        status: 'initiated',
        amount: input.amount,
        currency: input.currency,
        checkoutUrl: `https://checkout.moyasar.com/invoices/${invoiceId}`,
        expiredAt: input.expiresAt,
        providerUpdatedAt: time,
        paymentId: null,
        refundedAmount: 0,
      };
      return structuredClone(providerInvoice);
    },
    async fetchInvoice(id) {
      assert.equal(id, invoiceId);
      return structuredClone(providerInvoice);
    },
  };
  const { handlers: h } = createService({
    db,
    clock: () => time,
    ticketKey: () => 'local-test-signing-key-32-characters-minimum',
    qrCode: async (p) => `data:image/png;base64,${Buffer.from(p).toString('base64')}`,
    verifyFile: async () => {},
    paymentGateway,
    messagingProvider: {
      async sendTemplate(message) {
        sentMessages.push(structuredClone(message));
        return { provider: 'test-whatsapp', messageId: `message-${sentMessages.length}` };
      },
    },
    privateAssetUrl: async (path) => `https://storage.example.test/${encodeURIComponent(path)}`,
    siteOrigin: () => 'https://medadtahaya.com',
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
  await ref.update({ status: 'pending_payment', pricing: null });
  await assert.rejects(invoke('createPaymentSession', owner, { orderId: id }));
  await assert.rejects(invoke('importGuests', admin, { orderId: id, rows: guestRows() }));
  await assert.rejects(
    invoke('approvePricing', other, {
      orderId: id,
      expiresAt: time + 3 * 86400000,
    }),
  );
  const quote = await invoke('approvePricing', admin, {
    orderId: id,
    additionalAmountHalalas: 1000,
    discountHalalas: 500,
    taxHalalas: 3075,
    expiresAt: time + 3 * 86400000,
  });
  assert.equal(quote.pricing.totalHalalas, 23475);
  const paymentRequestId = randomUUID();
  const session = await invoke('createPaymentSession', owner, {
    orderId: id,
    requestId: paymentRequestId,
  });
  assert.equal(session.invoiceId, invoiceId);
  assert.equal(session.paymentStatus, 'pending');
  assert.equal(
    (
      await invoke('createPaymentSession', owner, {
        orderId: id,
        requestId: paymentRequestId,
      })
    ).invoiceId,
    invoiceId,
  );
  assert.equal(createdInvoices, 1, 'idempotent retry must not create a second provider invoice');
  await assert.rejects(invoke('syncPaymentSession', other, { orderId: id }));
  providerInvoice = {
    ...providerInvoice,
    status: 'paid',
    checkoutUrl: null,
    paymentId: '22222222-2222-4222-8222-222222222222',
    providerUpdatedAt: time + 1000,
  };
  assert.equal((await invoke('syncPaymentSession', owner, { orderId: id })).paymentStatus, 'paid');
  assert.equal((await ref.get()).data().paidAmountHalalas, 23475);
  assert.equal((await invoke('syncPaymentSession', owner, { orderId: id })).paymentStatus, 'paid');
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
  await ref.update({
    customDesign: true,
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
  assert.deepEqual(await invoke('sendInvitations', admin, { orderId: id, guestIds }), {
    sent: 2,
    failed: 0,
    skipped: 0,
  });
  assert.deepEqual(await invoke('sendInvitations', admin, { orderId: id, guestIds }), {
    sent: 0,
    failed: 0,
    skipped: 2,
  });
  assert.equal(sentMessages.length, 2);
  assert.equal(
    (await invoke('scheduleReminders', admin, { orderId: id, hours: [72, 24] })).schedule.length,
    2,
  );
  await assert.rejects(invoke('getInvitation', null, { token: first.links[0].token }));
  await assert.rejects(invoke('getInvitation', null, { token: 'x'.repeat(43) }));
  await assert.rejects(invoke('importGuests', admin, { orderId: id, rows: guestRows() }));
  const token = links.links[0].token;
  const publicData = await invoke('getInvitation', null, { token });
  assert.ok(!JSON.stringify(publicData).includes(owner.token.phone_number));
  assert.match(publicData.event.designUrl, /^https:\/\/storage\.example\.test\//);
  assert.equal(publicData.response, null);
  const input = {
    token,
    attendance: 'yes',
    guestName: 'ضيف اختبار',
    companionNames: [],
    message: 'تهنئة',
    privacyAccepted: true,
    requestId: randomUUID(),
  };
  await assert.rejects(
    invoke('submitRsvp', null, { ...input, privacyAccepted: false, requestId: randomUUID() }),
  );
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
  await invoke('reopenRsvp', owner, { orderId: id, guestId: guestIds[0] });
  assert.equal((await ref.get()).data().acceptedSeats, 0);
  assert.equal((await ref.get()).data().checkedInSeats, 0);
  assert.equal((await invoke('getInvitation', null, { token })).response, null);
  const reopened = await invoke('submitRsvp', null, {
    ...input,
    requestId: randomUUID(),
  });
  assert.equal(reopened.response.attendance, 'yes');
  await invoke('checkInTicket', gate, {
    orderId: id,
    token: reopened.ticket.payload,
    requestId: randomUUID(),
  });
  assert.equal((await ref.get()).data().checkedInSeats, 1);

  const openCreated = await invoke('createOrder', owner, {
    requestId: randomUUID(),
    order: {
      ...baseOrder(),
      eventDate: '2030-10-20',
      registrationMode: 'open',
      invitationLimit: 2,
      seatCapacity: 2,
      maxCompanions: 1,
      allowWaitlist: true,
    },
  });
  const openRef = db.doc(`orders/${openCreated.id}`);
  await openRef.update({ paymentStatus: 'paid', status: 'pending_payment' });
  const published = await invoke('publishEvent', owner, { orderId: openCreated.id });
  assert.equal((await invoke('publishEvent', owner, { orderId: openCreated.id })).replayed, true);
  const publicEvent = await invoke('getPublicEvent', null, { token: published.token });
  assert.equal(publicEvent.registration.open, true);
  await assert.rejects(
    invoke(
      'registerPublicGuest',
      { uid: other.uid, token: { phone_number: other.token.phone_number } },
      {
        token: published.token,
        requestId: randomUUID(),
        attendance: 'yes',
        guestName: 'ضيف بلا موافقة',
        companionNames: [],
        message: '',
        privacyAccepted: false,
      },
    ),
  );
  const firstOpen = await invoke(
    'registerPublicGuest',
    { uid: other.uid, token: { phone_number: other.token.phone_number } },
    {
      token: published.token,
      requestId: randomUUID(),
      attendance: 'yes',
      guestName: 'ضيف الرابط الأول',
      companionNames: ['مرافق أول'],
      message: 'تهنئة جميلة',
      privacyAccepted: true,
    },
  );
  assert.equal(firstOpen.response.attendance, 'yes');
  assert.ok(firstOpen.ticket);
  assert.equal(
    (
      await invoke(
        'registerPublicGuest',
        { uid: other.uid, token: { phone_number: other.token.phone_number } },
        {
          token: published.token,
          requestId: randomUUID(),
          attendance: 'no',
          guestName: 'محاولة مكررة',
          companionNames: [],
          message: '',
          privacyAccepted: true,
        },
      )
    ).duplicate,
    true,
  );
  const waitlisted = await invoke(
    'registerPublicGuest',
    { uid: 'customer-c', token: { phone_number: '+966500000003' } },
    {
      token: published.token,
      requestId: randomUUID(),
      attendance: 'yes',
      guestName: 'ضيف قائمة الانتظار',
      companionNames: ['مرافق انتظار'],
      message: '',
      privacyAccepted: true,
    },
  );
  assert.equal(waitlisted.response.attendance, 'waitlist');
  assert.deepEqual(waitlisted.response.companionNames, ['مرافق انتظار']);
  assert.equal(waitlisted.ticket, null);
  await assert.rejects(
    invoke(
      'registerPublicGuest',
      { uid: 'customer-d', token: { phone_number: '+966500000004' } },
      {
        token: published.token,
        requestId: randomUUID(),
        attendance: 'no',
        guestName: 'ضيف زائد',
        companionNames: [],
        message: '',
        privacyAccepted: true,
      },
    ),
  );
  const openOrder = (await openRef.get()).data();
  assert.equal(openOrder.guestCount, 2);
  assert.equal(openOrder.acceptedSeats, 2);
  assert.equal(openOrder.waitlistCount, 1);
  const report = await invoke('getOrderReport', owner, { orderId: openCreated.id });
  assert.equal(report.guests.length, 2);
  assert.ok(report.guests.every((guest) => /^\+9665\d{8}$/.test(guest.phone)));
  const firstReportPage = await invoke('getOrderReport', owner, {
    orderId: openCreated.id,
    pageSize: 1,
  });
  assert.equal(firstReportPage.guests.length, 1);
  assert.ok(firstReportPage.nextCursor);
  const secondReportPage = await invoke('getOrderReport', owner, {
    orderId: openCreated.id,
    pageSize: 1,
    cursor: firstReportPage.nextCursor,
  });
  assert.equal(secondReportPage.guests.length, 1);
  assert.notEqual(secondReportPage.guests[0].id, firstReportPage.guests[0].id);
  time = Date.parse('2030-10-13T00:00:00Z');
  await assert.rejects(invoke('getInvitation', null, { token }));
  await assert.rejects(invoke('verifyTicket', gate, { orderId: id, token: ticket }));
  return {
    orderId: id,
    checks:
      'ownership, approved pricing, hosted payment idempotency, verified provider sync, consent, upload limits, approval, guest duplicates, token rotation, WhatsApp idempotency, reminders, RSVP race, reopen counters, open registration, capacity waitlist, reports, event assignment, check-in race and expiry',
  };
}
