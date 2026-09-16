import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runScenarios } from '../helpers/service-scenarios.mjs';
let env, adminApp;
const projectId = 'demo-medad-audit';
before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    'Run with npm run test:integration; never use a production database.',
  );
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
    storage: { rules: await readFile('storage.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId }, 'test-admin');
});
after(async () => {
  await env?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});
test('Firestore rules isolate customers and prohibit browser authority writes', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'orders', 'order-a'), {
      ownerUid: 'alice',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      createdAt: 1,
    });
    await setDoc(doc(db, 'orders', 'order-b'), { ownerUid: 'bob', status: 'pending_payment' });
    await setDoc(doc(db, 'orders/order-a/guests/guest-a'), {
      displayName: 'Guest',
      ownerUid: 'alice',
    });
    await setDoc(doc(db, 'orders/order-a/guestContacts/guest-a'), { phone: '+966500000001' });
    await setDoc(doc(db, 'inviteTokens/secret-hash'), { guestId: 'guest-a' });
  });
  const alice = env.authenticatedContext('alice').firestore(),
    bob = env.authenticatedContext('bob').firestore(),
    admin = env.authenticatedContext('admin', { admin: true }).firestore(),
    gate = env.authenticatedContext('gate', { gate: true }).firestore(),
    publicDb = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(alice, 'orders/order-a')));
  await assertFails(getDoc(doc(bob, 'orders/order-a')));
  await assertFails(getDoc(doc(publicDb, 'orders/order-a')));
  await assertSucceeds(
    getDocs(query(collection(alice, 'orders'), where('ownerUid', '==', 'alice'))),
  );
  await assertFails(getDocs(collection(alice, 'orders')));
  await assertSucceeds(getDocs(collection(admin, 'orders')));
  for (const db of [alice, bob, admin, gate, publicDb]) {
    await assertFails(updateDoc(doc(db, 'orders/order-a'), { paymentStatus: 'paid' }));
    await assertFails(getDoc(doc(db, 'inviteTokens/secret-hash')));
    await assertFails(getDoc(doc(db, 'orders/order-a/guestContacts/guest-a')));
  }
  await assertSucceeds(getDoc(doc(alice, 'orders/order-a/guests/guest-a')));
  await assertFails(getDoc(doc(gate, 'orders/order-a/guests/guest-a')));
});
test('Storage rules require a matching upload reservation and immutable objects', async () => {
  const path = 'orders/order-storage/references/upload-test';
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'orders/order-storage'), {
      ownerUid: 'alice',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
    });
    await setDoc(doc(context.firestore(), 'uploads/upload-test'), {
      ownerUid: 'alice',
      orderId: 'order-storage',
      kind: 'reference',
      status: 'pending',
      expiresAt: Date.now() + 600000,
      contentType: 'image/png',
      size: 4,
    });
  });
  const a = env.authenticatedContext('alice').storage(),
    b = env.authenticatedContext('bob').storage();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await assertFails(uploadBytes(ref(b, path), bytes, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(a, path), bytes, { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(a, path), new Uint8Array(5), { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(a, path), bytes, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(a, path), bytes, { contentType: 'image/png' }));
  await assertFails(getBytes(ref(b, path)));
  await assertSucceeds(getBytes(ref(a, path)));
});
test('real Firestore transactions enforce the complete business flow', async () => {
  await runScenarios(getFirestore(adminApp));
});
