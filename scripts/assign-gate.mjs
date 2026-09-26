import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const [projectId, uid, orderId, mode = 'grant'] = process.argv.slice(2);
if (
  !projectId ||
  !uid ||
  !/^[A-Za-z0-9_-]{16,80}$/.test(orderId || '') ||
  !['grant', 'revoke'].includes(mode)
)
  throw new Error('Usage: node scripts/assign-gate.mjs PROJECT_ID USER_UID ORDER_ID grant|revoke');
const app = initializeApp({ projectId, credential: applicationDefault() });
try {
  const user = await getAuth(app).getUser(uid);
  if (!user.customClaims?.gate || user.disabled)
    throw new Error('The user must be an enabled gate user.');
  const db = getFirestore(app);
  const order = await db.doc(`orders/${orderId}`).get();
  if (!order.exists) throw new Error('Order does not exist.');
  const batch = db.batch();
  batch.set(db.doc(`gateAssignments/${uid}/orders/${orderId}`), {
    active: mode === 'grant',
    updatedAt: Date.now(),
  });
  batch.create(db.collection('auditLogs').doc(), {
    actorType: 'trusted-operator',
    action: `gate.${mode}`,
    targetUid: uid,
    orderId,
    at: Date.now(),
  });
  await batch.commit();
  console.log(`Gate assignment ${mode} completed in ${projectId}.`);
} finally {
  await deleteApp(app);
}
