// Public web configuration only. NEVER add service-account or payment secrets here.
export const firebaseSettings = Object.freeze({
  enabled: false,
  firebase: {
    apiKey: 'AIzaSyB2Ewbo1hmGYdutnV55tvbP8BxzF1_epi4',
    authDomain: 'medadaltahaya.firebaseapp.com',
    projectId: 'medadaltahaya',
    storageBucket: 'medadaltahaya.firebasestorage.app',
    messagingSenderId: '203246514140',
    appId: '1:203246514140:web:ed3e150b77d3fea3336919',
  },
  functionsRegion: 'europe-west1',
  appCheckSiteKey: '',
  useEmulators: false,
});