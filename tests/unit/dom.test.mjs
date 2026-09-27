import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const mockClient = `
const sample={id:'order-test-123456789',ownerUid:'customer-a',ownerName:'عميل اختبار',phone:'+966500000001',packageId:'basic',honorees:'مناسبة اختبار',occasion:'حفل زفاف',eventDate:'2030-10-12',eventTime:'20:00',eventAt:1918069200000,venueName:'قاعة',city:'الرياض',mapUrl:'https://maps.google.com',baseAmountHalalas:19900,invitationLimit:2,seatCapacity:6,registrationMode:'private',maxCompanions:2,companionNamesRequired:true,allowWaitlist:false,guestCount:0,acceptedCount:0,acceptedSeats:0,declinedCount:0,checkedInCount:0,checkedInSeats:0,paymentStatus:'unpaid',status:'pending_payment',designStatus:'approved',designVersion:'template:classic:v1',approvedDesignVersion:'template:classic:v1',reminderHours:[48],reminderStatus:'configured',automaticPricing:{subtotalHalalas:19900,items:[{label:'البطاقة الذكية',amountHalalas:19900}]},pricing:{status:'approved',currency:'SAR',items:[{label:'البطاقة الذكية',amountHalalas:19900}],discountHalalas:0,taxHalalas:0,totalHalalas:19900,expiresAt:1918069200000}};
const user={uid:'customer-a',phoneNumber:'+966500000001'};
export async function getClient(){return {auth:{currentUser:user},sdk:{getIdTokenResult:async()=>({claims:{admin:true,gate:true}}),onAuthStateChanged:()=>()=>{},signOut:async()=>{},updateProfile:async()=>{},RecaptchaVerifier:class{async render(){}clear(){}},signInWithEmailAndPassword:async()=>({user}),signInWithPhoneNumber:async()=>({confirm:async()=>({user})})}};}
export async function call(name,data){window.__calls.push({name,data});if(name==='createOrder')return {id:sample.id};if(name==='getGateAssignments')return {orders:[sample]};if(name==='getInvitation')return {event:sample,guest:{displayName:'ضيف اختبار',companionsLimit:2,companionNamesRequired:true},response:null,ticket:null};if(name==='getPublicEvent')return {event:sample,registration:{mode:'open',open:true,remainingSeats:6,maxCompanions:2,companionNamesRequired:true,allowWaitlist:false}};return {};}
export async function getOrder(id,options){window.__fresh=options?.fresh;if(window.__orderFailure)throw Object.assign(new Error('تعذر التحقق'),{code:window.__orderFailure});return {...sample,...window.__orderOverrides};}
export async function watchOrders(user,admin,fn){fn([sample]);return ()=>{};}
export async function watchGuests(id,fn){fn([]);return ()=>{};}
export async function uploadFile(){}export async function privateFileUrl(){return '';}
export async function getFullOrderReport(){return {order:sample,guests:[]};}
`;
const unconfiguredFirebase = `
export const firebaseSettings = Object.freeze({
  enabled: false,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: 'demo-unconfigured',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
  functionsRegion: 'me-central2',
  appCheckSiteKey: '',
  useEmulators: false,
});
`;
function virtualModule(name, filter, contents) {
  return {
    name,
    setup(builder) {
      builder.onResolve({ filter }, () => ({ path: name, namespace: name }));
      builder.onLoad({ filter: /.*/, namespace: name }, () => ({ contents, loader: 'js' }));
    },
  };
}
const mockClientPlugin = virtualModule('mock-client', /firebase-client\.js$/, mockClient);
const unconfiguredFirebasePlugin = virtualModule(
  'unconfigured-firebase',
  /firebase-config\.js$/,
  unconfiguredFirebase,
);
async function dom(file, entry, { mock = true, unconfigured = false, url } = {}) {
  const html = await readFile(file, 'utf8');
  const d = new JSDOM(html, {
    url: url || `https://local.test/${file}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  d.window.__calls = [];
  Object.defineProperty(d.window, 'crypto', { value: webcrypto });
  d.window.scrollTo = () => {};
  d.window.URL.createObjectURL = () => 'blob:local';
  d.window.URL.revokeObjectURL = () => {};
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: mock ? [mockClientPlugin] : unconfigured ? [unconfiguredFirebasePlugin] : [],
  });
  d.window.eval(bundle.outputFiles[0].text);
  await new Promise((resolve) => setTimeout(resolve, 35));
  return d;
}
test('missing session data and unsafe return URLs fail safely', async () => {
  const d = new JSDOM('', {
    url: 'https://local.test/Liqora-website/login.html',
    runScripts: 'outside-only',
  });
  const bundle = await build({
    entryPoints: ['js/platform.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'Utilities',
  });
  d.window.eval(bundle.outputFiles[0].text);
  const u = d.window.Utilities;
  assert.deepEqual(u.storageGet('missing', { fallback: true }), { fallback: true });
  assert.equal(
    u.errorMessage({ code: 'auth/billing-not-enabled' }),
    'إرسال رمز التحقق غير متاح مؤقتًا حتى يكتمل تفعيل خدمة الرسائل.',
  );
  for (const path of [
    '//evil.test',
    'https://evil.test',
    'javascript:alert(1)',
    '../admin.html',
    'login.html',
  ])
    assert.equal(u.safeReturn(path), 'dashboard.html');
  assert.equal(u.safeReturn('order.html?package=basic'), 'order.html?package=basic');
  assert.equal(u.safeReturn('index.html', 'dashboard.html'), 'index.html');
  d.window.close();
});
test('form cannot skip later steps and renders HTML payloads as text', async () => {
  const d = await dom('order.html', 'js/order.js'),
    w = d.window,
    doc = w.document,
    form = doc.getElementById('order-form');
  assert.ok(doc.body.classList.contains('auth-ready'));
  form.elements.packageId.value = 'basic';
  form.elements.invitationLimit.value = '2';
  form.elements.seatCapacity.value = '2';
  form.elements.registrationMode.value = 'open';
  doc.querySelector('[name=reminderHours][value="48"]').checked = true;
  form.dispatchEvent(new w.Event('change', { bubbles: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector('[data-step="2"]').hidden, false);
  assert.equal(w.__calls.length, 0);
  const attack = '<img src=x onerror="window.hacked=1">';
  const values = {
    ownerName: attack,
    occasion: 'حفل زفاف',
    honorees: 'مناسبة اختبار',
    eventDate: '2030-10-12',
    eventTime: '20:00',
    venueName: 'قاعة',
    city: 'الرياض',
    mapUrl: 'https://maps.google.com',
    maxCompanions: '2',
  };
  for (const [key, value] of Object.entries(values)) form.elements[key].value = value;
  doc.getElementById('next-step').click();
  form.elements.theme.value = 'classic';
  doc.getElementById('next-step').click();
  const review = doc.getElementById('review-grid');
  assert.ok(review.textContent.includes(attack));
  assert.equal(review.querySelector('img'), null);
  assert.equal(w.hacked, undefined);
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(w.__calls.length, 0, 'consent required');
  form.elements.termsAccepted.checked = true;
  form.elements.eventDate.value = '2000-01-01';
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(w.__calls.length, 0, 'earlier fields must be revalidated');
  d.window.close();
});
test('all connected page controllers initialize without missing DOM elements', async () => {
  for (const name of ['checkout', 'dashboard', 'admin', 'invitation', 'rsvp', 'join', 'checkin']) {
    const d = await dom(`${name}.html`, `js/${name}.js`, {
      url: `https://local.test/${name}.html?order=order-test-123456789#token=${'a'.repeat(43)}`,
    });
    assert.equal(d.window.document.getElementById('page-error').hidden, true, name);
    if (name === 'checkout')
      assert.equal(d.window.document.getElementById('checkout-status').textContent, 'جاهز للدفع');
    if (name === 'dashboard') {
      const tabs = d.window.document.querySelectorAll('[data-dashboard-tab]');
      assert.equal(tabs.length, 3);
      tabs[2].click();
      assert.equal(d.window.document.getElementById('profile-panel').hidden, false);
      assert.equal(d.window.document.getElementById('current-orders-panel').hidden, true);
    }
    d.window.close();
  }
});

test('homepage provides a direct route to the customer dashboard', async () => {
  const html = await readFile('index.html', 'utf8');
  const d = new JSDOM(html);
  const link = [...d.window.document.querySelectorAll('a')].find(
    (item) => item.getAttribute('href') === 'dashboard.html',
  );
  assert.ok(link);
  assert.ok(link.textContent.includes('لوحة التحكم'));
  d.window.close();
});
test('unconfigured Firebase shows a useful error and never grants access', async () => {
  for (const name of ['admin', 'dashboard', 'login']) {
    const d = await dom(`${name}.html`, `js/${name === 'login' ? 'login' : name}.js`, {
      mock: false,
      unconfigured: true,
    });
    const error = d.window.document.getElementById(
      name === 'login' ? 'customerPhoneError' : 'page-error',
    );
    assert.equal(error.hidden, false);
    assert.ok(error.textContent.includes('قيد الإعداد'));
    assert.equal(d.window.document.body.classList.contains('auth-ready'), false);
    d.window.close();
  }
});

test('checkout ignores URL success flags, reads fresh state, and warns when refreshing fails', async () => {
  const d = await dom('checkout.html', 'js/checkout.js', {
      url: 'https://local.test/checkout.html?order=order-test-123456789&status=paid&amount=1',
    }),
    w = d.window,
    doc = w.document;
  assert.equal(w.__fresh, true);
  assert.ok(doc.getElementById('checkout-total').textContent.includes('١٩٩'));
  assert.equal(doc.getElementById('checkout-status').textContent, 'جاهز للدفع');
  assert.equal(doc.getElementById('payment-action').disabled, false);
  w.__orderOverrides = { paymentStatus: 'processing' };
  doc.getElementById('refresh-payment').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.getElementById('checkout-status').textContent, 'الدفع قيد المعالجة');
  assert.equal(doc.getElementById('payment-action').hidden, false);
  assert.equal(doc.getElementById('payment-action').disabled, true);
  w.__orderFailure = 'unavailable';
  doc.getElementById('refresh-payment').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.getElementById('checkout-stale').hidden, false);
  assert.equal(doc.getElementById('refresh-payment').disabled, false);
  w.__orderFailure = 'permission-denied';
  doc.getElementById('refresh-payment').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.getElementById('checkout-content').hidden, true);
  d.window.close();
});
test('checkout without an order shows an actionable empty state', async () => {
  const d = await dom('checkout.html', 'js/checkout.js');
  assert.equal(d.window.document.getElementById('checkout-empty').hidden, false);
  assert.equal(d.window.document.getElementById('checkout-content').hidden, true);
  d.window.close();
});
test('package quantity boundaries and filters lead to suitable choices', async () => {
  const d = await dom('index.html', 'js/storefront.js'),
    w = d.window,
    doc = w.document,
    input = doc.getElementById('package-guests');
  input.value = '251';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(
    doc.querySelector('[data-package-link=basic]').getAttribute('aria-disabled'),
    'true',
  );
  assert.equal(
    doc.querySelector('[data-package-link=advanced]').getAttribute('href'),
    'order.html?package=advanced&guests=251',
  );
  assert.equal(doc.querySelector('[data-recommended=advanced]').hidden, false);
  input.value = '2001';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(doc.querySelector('[data-package-link=advanced]').hasAttribute('href'), false);
  assert.equal(doc.querySelector('[data-recommended=business]').hidden, false);
  input.value = '0';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(doc.getElementById('package-error').hidden, false);
  assert.ok([...doc.querySelectorAll('[data-package-link]')].every((a) => !a.hasAttribute('href')));
  doc.querySelector('[data-filter=celebration]').click();
  assert.equal(doc.querySelectorAll('[data-category]:not([hidden])').length, 1);
  const nav = doc.querySelector('.nav-toggle');
  nav.click();
  assert.equal(nav.getAttribute('aria-expanded'), 'true');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(nav.getAttribute('aria-expanded'), 'false');
  d.window.close();
});
test('preview treats names as text and responses remain explicit examples', async () => {
  const d = await dom('preview.html', 'js/preview.js', {
      url: 'https://local.test/preview.html?theme=floral',
    }),
    w = d.window,
    doc = w.document;
  const input = doc.getElementById('preview-names');
  input.value = '<img src=x onerror=alert(1)>';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(doc.querySelector('#preview-art strong img'), null);
  assert.ok(doc.querySelector('#preview-art strong').textContent.includes('<img'));
  assert.ok(doc.querySelector('#preview-art .invitation-art').classList.contains('art-floral'));
  doc.querySelector('[data-demo-response=yes]').click();
  assert.ok(doc.getElementById('demo-response').textContent.includes('تجربة فقط'));
  assert.equal(w.__calls.length, 0);
  d.window.close();
});
