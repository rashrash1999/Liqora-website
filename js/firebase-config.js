// Public web configuration only. NEVER add service-account or payment secrets here.
export const firebaseSettings = Object.freeze({
  enabled: false,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: 'medadaltahaya',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
  functionsRegion: 'europe-west1', // Match functions/index.js and your selected data region.
  appCheckSiteKey: '', // Public reCAPTCHA Enterprise key.
  useEmulators: false,
});
