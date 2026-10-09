import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Web app registered in the same Firebase project as the mobile apps
// (balancesheet-android). These values identify the project and are public
// by design; access is enforced by firestore.rules.
const app = initializeApp({
  apiKey: 'AIzaSyBDuAZWtX2160QulEmFG4h8e3FflqyRYPM',
  authDomain: 'balancesheet-android.firebaseapp.com',
  projectId: 'balancesheet-android',
  storageBucket: 'balancesheet-android.firebasestorage.app',
  messagingSenderId: '858326644205',
  appId: '1:858326644205:web:f223a94dbe37a736dda3e4',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
