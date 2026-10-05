import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// Web app config from Firebase Console -> Project settings (Diet-Planner).
// Realtime Database is the only Firebase product this app uses.
const firebaseConfig = {
  apiKey: 'AIzaSyAr4IYnykpwovqOJWzfBd7abVdAma_Ig3Q',
  authDomain: 'diet-planner-3bdf3.firebaseapp.com',
  databaseURL: 'https://diet-planner-3bdf3-default-rtdb.firebaseio.com',
  projectId: 'diet-planner-3bdf3',
  storageBucket: 'diet-planner-3bdf3.firebasestorage.app',
  messagingSenderId: '927878354911',
  appId: '1:927878354911:web:2e616b171a267b9910566a',
  measurementId: 'G-MSYWCM58MT',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const database = getDatabase(firebaseApp);
