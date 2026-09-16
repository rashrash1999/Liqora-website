import { getClient } from './firebase-client.js';
import { $, busy, showError, safeReturn, normalizeSaudiPhone, digits } from './platform.js';
const params = new URLSearchParams(location.search),
  isAdmin = document.body.dataset.loginPage === 'admin';
let recaptcha, confirmation;
function destination(claims) {
  return safeReturn(
    params.get('return'),
    isAdmin ? (claims.admin ? 'admin.html' : 'checkin.html') : 'dashboard.html',
  );
}
async function finish(user, sdk, auth) {
  const { claims } = await sdk.getIdTokenResult(user, true);
  if (isAdmin && !claims.admin && !claims.gate) {
    await sdk.signOut(auth);
    throw new Error('هذا الحساب غير مخوّل للإدارة أو الاستقبال.');
  }
  location.assign(destination(claims));
}
async function start() {
  const { sdk, auth } = await getClient();
  if (auth.currentUser && (isAdmin || auth.currentUser.phoneNumber)) {
    await finish(auth.currentUser, sdk, auth);
    return;
  }
  if (isAdmin) {
    $('togglePassword').addEventListener('click', (event) => {
      const input = $('adminPassword'),
        visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      event.currentTarget.textContent = visible ? 'إظهار' : 'إخفاء';
      event.currentTarget.setAttribute(
        'aria-label',
        visible ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور',
      );
    });
    $('adminLoginForm').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      const button = event.currentTarget.querySelector('[type=submit]');
      busy(button, async () => {
        try {
          $('adminLoginError').hidden = true;
          const credential = await sdk.signInWithEmailAndPassword(
            auth,
            $('adminEmail').value.trim(),
            $('adminPassword').value,
          );
          $('adminPassword').value = '';
          await finish(credential.user, sdk, auth);
        } catch (error) {
          showError(error, 'adminLoginError');
        }
      });
    });
    return;
  }
  recaptcha = new sdk.RecaptchaVerifier(auth, 'recaptcha-container', { size: 'normal' });
  await recaptcha.render();
  $('customerPhoneForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const phone = normalizeSaudiPhone($('customerPhone').value);
    if (!phone) {
      showError(new Error('أدخل رقم جوال سعودي صحيحًا.'), 'customerPhoneError');
      return;
    }
    busy(event.currentTarget.querySelector('[type=submit]'), async () => {
      try {
        $('customerPhoneError').hidden = true;
        confirmation = await sdk.signInWithPhoneNumber(auth, phone, recaptcha);
        $('verificationPhone').textContent = phone;
        $('customerPhoneForm').hidden = true;
        $('customerOtpForm').hidden = false;
        $('customerOtp').focus();
      } catch (error) {
        showError(error, 'customerPhoneError');
        recaptcha.clear();
        recaptcha = new sdk.RecaptchaVerifier(auth, 'recaptcha-container', { size: 'normal' });
        await recaptcha.render();
      }
    });
  });
  $('customerOtpForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!confirmation) return;
    const code = digits($('customerOtp').value).trim();
    if (!/^\d{6}$/.test(code)) {
      showError(new Error('أدخل رمز التحقق المكون من ستة أرقام.'), 'customerOtpError');
      return;
    }
    busy(event.currentTarget.querySelector('[type=submit]'), async () => {
      try {
        $('customerOtpError').hidden = true;
        const credential = await confirmation.confirm(code);
        await finish(credential.user, sdk, auth);
      } catch (error) {
        showError(error, 'customerOtpError');
      }
    });
  });
  $('changePhone').addEventListener('click', () => {
    confirmation = null;
    $('customerOtp').value = '';
    $('customerOtpForm').hidden = true;
    $('customerPhoneForm').hidden = false;
    $('customerPhone').focus();
  });
}
start().catch((error) => {
  showError(error, isAdmin ? 'adminLoginError' : 'customerPhoneError');
  document.querySelectorAll('button[type=submit]').forEach((b) => {
    b.disabled = true;
  });
});
