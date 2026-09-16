import { firebaseSettings as settings } from './firebase-config.js';
let clientPromise;
export function getClient() {
  if (!clientPromise)
    clientPromise = (async () => {
      if (
        !settings.enabled ||
        !settings.firebase.apiKey ||
        !settings.firebase.appId ||
        !settings.firebase.authDomain
      )
        throw new Error('الخدمة قيد الإعداد. تواصل مع إدارة الموقع لإتمام طلبك.');
      const local = ['localhost', '127.0.0.1'].includes(location.hostname);
      if (settings.useEmulators && (!local || !settings.firebase.projectId.startsWith('demo-')))
        throw new Error('إعداد الاختبار غير صالح على هذا النطاق.');
      if (!settings.useEmulators && !settings.appCheckSiteKey)
        throw new Error('الخدمة قيد الإعداد. حاول لاحقًا.');
      const sdk = await import('./vendor/firebase.js');
      const app = sdk.initializeApp(settings.firebase);
      if (!settings.useEmulators)
        sdk.initializeAppCheck(app, {
          provider: new sdk.ReCaptchaEnterpriseProvider(settings.appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      const auth = sdk.getAuth(app),
        db = sdk.getFirestore(app),
        functions = sdk.getFunctions(app, settings.functionsRegion),
        storage = sdk.getStorage(app);
      if (settings.useEmulators) {
        sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        sdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
        sdk.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
        sdk.connectStorageEmulator(storage, '127.0.0.1', 9199);
      }
      auth.languageCode = 'ar';
      await sdk.setPersistence(auth, sdk.browserSessionPersistence);
      await auth.authStateReady();
      return { sdk, app, auth, db, functions, storage };
    })();
  return clientPromise;
}
export async function call(name, data = {}) {
  const { sdk, functions } = await getClient();
  return (await sdk.httpsCallable(functions, name, { timeout: 60000 })(data)).data;
}
export async function getOrder(id, { fresh = false } = {}) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(id || '')) throw new Error('اختر طلبًا من لوحة مناسبتك.');
  const { sdk, db } = await getClient();
  const read = fresh ? sdk.getDocFromServer : sdk.getDoc;
  const snap = await read(sdk.doc(db, 'orders', id));
  if (!snap.exists()) throw Object.assign(new Error('الطلب غير موجود.'), { code: 'not-found' });
  return { id: snap.id, ...snap.data() };
}
export async function watchOrders(user, isAdmin, onData, onError) {
  const { sdk, db } = await getClient();
  const filters = isAdmin ? [] : [sdk.where('ownerUid', '==', user.uid)];
  return sdk.onSnapshot(
    sdk.query(
      sdk.collection(db, 'orders'),
      ...filters,
      sdk.orderBy('createdAt', 'desc'),
      sdk.limit(100),
    ),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}
export async function watchGuests(orderId, onData, onError) {
  const { sdk, db } = await getClient();
  return sdk.onSnapshot(
    sdk.query(
      sdk.collection(db, 'orders', orderId, 'guests'),
      sdk.orderBy('createdAt'),
      sdk.limit(10000),
    ),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}
export async function uploadFile(orderId, file, kind = 'reference') {
  const allowed =
    kind === 'design'
      ? ['image/png', 'image/jpeg', 'image/webp']
      : ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  if (!file || file.size === 0 || file.size > 10 * 1024 * 1024 || !allowed.includes(file.type))
    throw new Error('اختر ملفًا مسموحًا بحجم لا يتجاوز 10MB.');
  const { path } = await call('prepareUpload', {
    orderId,
    kind,
    contentType: file.type,
    size: file.size,
  });
  const { sdk, storage } = await getClient();
  await sdk.uploadBytes(sdk.ref(storage, path), file, { contentType: file.type });
  await call('registerUpload', { orderId, path, kind });
  return path;
}
export async function privateFileUrl(path) {
  const { sdk, storage } = await getClient();
  return URL.createObjectURL(await sdk.getBlob(sdk.ref(storage, path), 10 * 1024 * 1024));
}
