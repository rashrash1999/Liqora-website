export { initializeApp } from 'firebase/app';
export {
  getAuth,
  onAuthStateChanged,
  getIdTokenResult,
  signOut,
  signInWithEmailAndPassword,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  setPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
} from 'firebase/auth';
export {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  connectFirestoreEmulator,
} from 'firebase/firestore';
export { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
export { getStorage, ref, uploadBytes, getBlob, connectStorageEmulator } from 'firebase/storage';
export { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
