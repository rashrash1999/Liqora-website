import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const [projectId, uid, role] = process.argv.slice(2);
if (!projectId || !uid || !['admin', 'gate', 'customer'].includes(role))
  throw new Error('Usage: node scripts/set-role.mjs PROJECT_ID USER_UID admin|gate|customer');
const app = initializeApp({ projectId, credential: applicationDefault() });
try {
  const auth = getAuth(app),
    user = await auth.getUser(uid);
  if (user.disabled) throw new Error('The account is disabled.');
  const claims = { ...user.customClaims };
  delete claims.admin;
  delete claims.gate;
  if (role !== 'customer') claims[role] = true;
  await auth.setCustomUserClaims(uid, claims);
  await auth.revokeRefreshTokens(uid);
  console.log(`Updated role ${role} for UID ${uid} in project ${projectId}. Sign in again.`);
} finally {
  await deleteApp(app);
}
