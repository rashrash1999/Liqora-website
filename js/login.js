import { getClient } from './firebase-client.js';
import { $, busy, showError, safeReturn } from './platform.js';

const params = new URLSearchParams(location.search),
  isAdmin = document.body.dataset.loginPage === 'admin';
let customerMode = 'login';

function destination(claims) {
  return safeReturn(
    params.get('return'),
    isAdmin ? (claims.admin ? 'admin.html' : 'checkin.html') : 'index.html',
  );
}

async function finish(user, sdk, auth) {
  if (!isAdmin && (!user.email || !user.emailVerified))
    throw Object.assign(new Error('تحقق من بريدك الإلكتروني أولًا، ثم سجّل الدخول مجددًا.'), {
      code: 'auth/email-not-verified',
    });
  const { claims } = await sdk.getIdTokenResult(user, true);
  if (isAdmin && !claims.admin && !claims.gate) {
    await sdk.signOut(auth);
    throw new Error('هذا الحساب غير مخوّل للإدارة أو الاستقبال.');
  }
  location.assign(destination(claims));
}

function setCustomerMode(mode) {
  customerMode = mode;
  const registering = mode === 'register';
  $('customerNameField').hidden = !registering;
  $('customerConfirmField').hidden = !registering;
  $('customerName').required = registering;
  $('customerPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('customerPasswordConfirm').required = registering;
  $('customerAuthSubmit').textContent = registering ? 'إنشاء الحساب' : 'تسجيل الدخول';
  $('forgotPassword').hidden = registering;
  $('resendVerification').hidden = true;
  $('customerAuthError').hidden = true;
  $('customerAuthStatus').hidden = true;
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    const selected = button.dataset.authMode === mode;
    button.setAttribute('aria-selected', String(selected));
    button.classList.toggle('is-selected', selected);
  });
}

async function start() {
  const { sdk, auth } = await getClient();
  if (auth.currentUser && isAdmin) {
    await finish(auth.currentUser, sdk, auth);
    return;
  }
  if (auth.currentUser?.emailVerified) {
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

  setCustomerMode('login');
  if (auth.currentUser && !auth.currentUser.emailVerified) {
    $('customerEmail').value = auth.currentUser.email || '';
    $('customerAuthStatus').textContent =
      'الحساب موجود لكنه ينتظر توثيق البريد. افتح رسالة التحقق ثم سجّل الدخول.';
    $('customerAuthStatus').hidden = false;
    $('resendVerification').hidden = false;
  } else if (params.get('verify') === '1') {
    $('customerAuthStatus').textContent = 'يجب توثيق البريد الإلكتروني قبل فتح لوحة المناسبة.';
    $('customerAuthStatus').hidden = false;
  }

  document
    .querySelectorAll('[data-auth-mode]')
    .forEach((button) =>
      button.addEventListener('click', () => setCustomerMode(button.dataset.authMode)),
    );

  $('customerAuthForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const email = $('customerEmail').value.trim().toLowerCase(),
      password = $('customerPassword').value;
    busy($('customerAuthSubmit'), async () => {
      try {
        $('customerAuthError').hidden = true;
        $('customerAuthStatus').hidden = true;
        if (customerMode === 'register') {
          const name = $('customerName').value.trim();
          if (name.length < 3 || name.length > 100)
            throw new Error('اكتب الاسم الكامل من 3 إلى 100 حرف.');
          if (password !== $('customerPasswordConfirm').value)
            throw new Error('كلمتا المرور غير متطابقتين.');
          const credential = await sdk.createUserWithEmailAndPassword(auth, email, password);
          await sdk.updateProfile(credential.user, { displayName: name });
          await sdk.sendEmailVerification(credential.user);
          await sdk.signOut(auth);
          setCustomerMode('login');
          $('customerEmail').value = email;
          $('customerPassword').value = '';
          $('customerPasswordConfirm').value = '';
          $('customerAuthStatus').textContent =
            'أنشئ الحساب بنجاح. أرسلنا رابط التحقق إلى بريدك؛ افتحه ثم عد لتسجيل الدخول.';
          $('customerAuthStatus').hidden = false;
          return;
        }
        const credential = await sdk.signInWithEmailAndPassword(auth, email, password);
        $('customerPassword').value = '';
        if (!credential.user.emailVerified) {
          $('resendVerification').hidden = false;
          throw Object.assign(new Error('تحقق من بريدك الإلكتروني أولًا، ثم سجّل الدخول مجددًا.'), {
            code: 'auth/email-not-verified',
          });
        }
        await finish(credential.user, sdk, auth);
      } catch (error) {
        showError(error, 'customerAuthError');
      }
    });
  });

  $('forgotPassword').addEventListener('click', () => {
    const email = $('customerEmail').value.trim().toLowerCase();
    if (!$('customerEmail').checkValidity() || !email) {
      showError(new Error('اكتب بريدك الإلكتروني الصحيح أولًا.'), 'customerAuthError');
      $('customerEmail').focus();
      return;
    }
    busy($('forgotPassword'), async () => {
      try {
        await sdk.sendPasswordResetEmail(auth, email);
        $('customerAuthError').hidden = true;
        $('customerAuthStatus').textContent =
          'أرسلنا رابط إعادة تعيين كلمة المرور إذا كان البريد مسجلًا لدينا.';
        $('customerAuthStatus').hidden = false;
      } catch (error) {
        showError(error, 'customerAuthError');
      }
    });
  });

  $('resendVerification').addEventListener('click', () =>
    busy($('resendVerification'), async () => {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error('سجّل الدخول أولًا لإعادة إرسال رسالة التحقق.');
        await sdk.sendEmailVerification(user);
        $('customerAuthError').hidden = true;
        $('customerAuthStatus').textContent = 'أعدنا إرسال رسالة التحقق إلى بريدك.';
        $('customerAuthStatus').hidden = false;
      } catch (error) {
        showError(error, 'customerAuthError');
      }
    }),
  );
}

start().catch((error) => {
  showError(error, isAdmin ? 'adminLoginError' : 'customerAuthError');
  document.querySelectorAll('button[type=submit]').forEach((button) => {
    button.disabled = true;
  });
});
