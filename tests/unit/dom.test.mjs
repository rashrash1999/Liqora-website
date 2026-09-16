import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const mockClient = `
const sample={id:'order-test-123456789',ownerUid:'customer-a',ownerName:'عميل اختبار',phone:'+966500000001',packageId:'basic',honorees:'مناسبة اختبار',occasion:'حفل زفاف',eventDate:'2030-10-12',eventTime:'20:00',eventAt:1918069200000,venueName:'قاعة',city:'الرياض',baseAmountHalalas:19900,expectedGuests:2,guestCount:0,acceptedCount:0,declinedCount:0,checkedInCount:0,paymentStatus:'unpaid',status:'pending_payment',designStatus:'none',reminderHours:48,reminderStatus:'not_requested'};
const user={uid:'customer-a',phoneNumber:'+966500000001'};
export async function getClient(){return {auth:{currentUser:user},sdk:{getIdTokenResult:async()=>({claims:{admin:true,gate:true}}),onAuthStateChanged:()=>()=>{},signOut:async()=>{},RecaptchaVerifier:class{async render(){}clear(){}},signInWithEmailAndPassword:async()=>({user}),signInWithPhoneNumber:async()=>({confirm:async()=>({user})})}};}
export async function call(name,data){window.__calls.push({name,data});if(name==='createOrder')return {id:sample.id};if(name==='getGateAssignments')return {orders:[sample]};if(name==='getInvitation')return {event:sample,guest:{displayName:'ضيف اختبار',companionsLimit:2},response:null,ticket:null};return {};}
export async function getOrder(id,options){window.__fresh=options?.fresh;if(window.__orderFailure)throw Object.assign(new Error('تعذر التحقق'),{code:window.__orderFailure});return {...sample,...window.__orderOverrides};}
export async function watchOrders(user,admin,fn){fn([sample]);return ()=>{};}
export async function watchGuests(id,fn){fn([]);return ()=>{};}
export async function uploadFile(){}export async function privateFileUrl(){return '';}
`;
async function dom(file, entry, { mock = true, url } = {}) {
  const html = await readFile(file, 'utf8');
  const d = new JSDOM(html, {
    url: url || `https://local.test/${file}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  d.window.__calls = [];
  d.window.scrollTo = () => {};
  d.window.URL.createObjectURL = () => 'blob:local';
  d.window.URL.revokeObjectURL = () => {};
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: mock
      ? [
          {
            name: 'mock-client',
            setup(b) {
              b.onResolve({ filter: /firebase-client\.js$/ }, () => ({
                path: 'firebase-client',
                namespace: 'test',
              }));
              b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                contents: mockClient,
                loader: 'js',
              }));
            },
          },
        ]
      : [],
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
  for (const path of [
    '//evil.test',
    'https://evil.test',
    'javascript:alert(1)',
    '../admin.html',
    'login.html',
  ])
    assert.equal(u.safeReturn(path), 'dashboard.html');
  assert.equal(u.safeReturn('order.html?package=basic'), 'order.html?package=basic');
  d.window.close();
});
test('form cannot skip later steps and renders HTML payloads as text', async () => {
  const d = await dom('order.html', 'js/order.js'),
    w = d.window,
    doc = w.document,
    form = doc.getElementById('order-form');
  assert.ok(doc.body.classList.contains('auth-ready'));
  form.elements.packageId.value = 'basic';
  form.elements.expectedGuests.value = '2';
  form.elements.reminderHours.value = '48';
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
  for (const name of ['checkout', 'dashboard', 'admin', 'invitation', 'checkin']) {
    const d = await dom(`${name}.html`, `js/${name}.js`, {
      url: `https://local.test/${name}.html?order=order-test-123456789#token=${'a'.repeat(43)}`,
    });
    assert.equal(d.window.document.getElementById('page-error').hidden, true, name);
    if (name === 'checkout')
      assert.equal(
        d.window.document.getElementById('checkout-status').textContent,
        'بانتظار استكمال الدفع',
      );
    d.window.close();
  }
});
test('unconfigured Firebase shows a useful error and never grants access', async () => {
  for (const name of ['admin', 'dashboard', 'login']) {
    const d = await dom(`${name}.html`, `js/${name === 'login' ? 'login' : name}.js`, {
      mock: false,
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
  assert.equal(doc.getElementById('checkout-total').textContent, 'لم يُعتمد بعد');
  assert.equal(doc.getElementById('checkout-status').textContent, 'بانتظار استكمال الدفع');
  assert.equal(doc.getElementById('payment-action').disabled, true);
  w.__orderOverrides = { paymentStatus: 'processing' };
  doc.getElementById('refresh-payment').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.getElementById('checkout-status').textContent, 'الدفع قيد المعالجة');
  assert.equal(doc.getElementById('payment-action').hidden, true);
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
  input.value = '101';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(
    doc.querySelector('[data-package-link=basic]').getAttribute('aria-disabled'),
    'true',
  );
  assert.equal(
    doc.querySelector('[data-package-link=advanced]').getAttribute('href'),
    'order.html?package=advanced&guests=101',
  );
  assert.equal(doc.querySelector('[data-recommended=advanced]').hidden, false);
  input.value = '501';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(doc.querySelector('[data-package-link=advanced]').hasAttribute('href'), false);
  assert.equal(doc.querySelector('[data-recommended=premium]').hidden, false);
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
