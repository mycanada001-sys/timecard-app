// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Replace the values below with your Firebase project config.
//         Firebase Console → Your Project → Project Settings → Your Apps → SDK setup
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB4E7Y6cypDGObdttc_VY1FB3PBaQ20dBY",
  authDomain: "timecard-app-6084a.firebaseapp.com",
  projectId: "timecard-app-6084a",
  storageBucket: "timecard-app-6084a.firebasestorage.app",
  messagingSenderId: "175854928800",
  appId: "1:175854928800:web:2373edc5686bd0e98edac5",
  measurementId: "G-22BYZZ38Z7"
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Nothing to change below — Firebase initializes with offline support.
// ─────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Enables offline caching via IndexedDB so the app works without internet.
// Queued writes sync automatically when connectivity returns.
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    // Multiple tabs open — persistence only works in one tab at a time.
    console.warn("Firebase offline persistence disabled: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    // Browser doesn't support IndexedDB (very rare).
    console.warn("Firebase offline persistence not supported in this browser.");
  }
});

export { db };
