import { getClient } from './firebase-client.js';
import { safeReturn, showError, storageRemove } from './platform.js';
export async function requireUser(role = 'customer') {
  const { auth, sdk } = await getClient(),
    user = auth.currentUser;
  if (!user) {
    const file = role === 'customer' ? 'login.html' : 'admin-login.html';
    location.replace(
      `${file}?return=${encodeURIComponent(safeReturn(location.pathname.split('/').pop() + location.search))}`,
    );
    return null;
  }
  const { claims } = await sdk.getIdTokenResult(user);
  if (role === 'admin' && !claims.admin) throw new Error('هذا الحساب لا يملك صلاحية الإدارة.');
  if (role === 'staff' && !claims.admin && !claims.gate)
    throw new Error('هذا الحساب لا يملك صلاحية الاستقبال.');
  if (role === 'customer' && !user.phoneNumber)
    throw new Error('سجّل الدخول بحساب العميل المرتبط برقم الجوال.');
  document.body.classList.add('auth-ready');
  sdk.onAuthStateChanged(auth, (next) => {
    if (!next) {
      document.body.classList.remove('auth-ready');
      location.replace(role === 'customer' ? 'login.html' : 'admin-login.html');
    }
  });
  document.querySelectorAll('[data-logout]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        storageRemove(`medad.draft.${user.uid}`);
        storageRemove(`medad.order.request.${user.uid}`);
        await sdk.signOut(auth);
      } catch (error) {
        showError(error);
      }
    }),
  );
  return { user, claims };
}
export function authFailure(error) {
  document.body.classList.add('auth-failed');
  showError(error);
  const panel = document.getElementById('protected-content');
  if (panel) panel.hidden = true;
}
