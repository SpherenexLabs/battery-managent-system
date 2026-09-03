import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Realtime Database is the only Firebase product this app uses, and it reaches
// the database through `databaseURL` alone. The remaining fields are filled in
// from the project id so the config is well formed; paste the real apiKey /
// messagingSenderId / appId from Firebase Console -> Project settings if you
// later add Auth, Storage or Analytics.
const firebaseConfig = {
  apiKey: 'AIzaSyA-smart-vehicle-2eeac-replace-me',
  authDomain: 'smart-vehicle-2eeac.firebaseapp.com',
  databaseURL: 'https://smart-vehicle-2eeac-default-rtdb.firebaseio.com',
  projectId: 'smart-vehicle-2eeac',
  storageBucket: 'smart-vehicle-2eeac.firebasestorage.app',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const database = getDatabase(firebaseApp);
