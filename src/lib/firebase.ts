import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  cache: { kind: 'MEMORY' },
}, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/gmail.send');

// Cache for the access token
let cachedAccessToken: string | null = localStorage.getItem('gmailAccessToken');

export const clearAccessToken = () => {
  localStorage.removeItem('gmailAccessToken');
  localStorage.removeItem('gmailAccessTokenTime');
  cachedAccessToken = null;
  // Dispatch a custom event to notify React components that Gmail status changed
  window.dispatchEvent(new Event('gmail-status-change'));
};

export const loginWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  cachedAccessToken = credential?.accessToken || null;
  if (cachedAccessToken) {
    localStorage.setItem('gmailAccessToken', cachedAccessToken);
    localStorage.setItem('gmailAccessTokenTime', Date.now().toString());
    window.dispatchEvent(new Event('gmail-status-change'));
  }
  return result;
};

export const getAccessToken = () => {
  const token = cachedAccessToken;
  if (!token) return null;
  const tokenTimeStr = localStorage.getItem('gmailAccessTokenTime');
  if (tokenTimeStr) {
    const tokenTime = parseInt(tokenTimeStr, 10);
    // Google OAuth access tokens expire in exactly 3600 seconds (1 hour). 
    // We clear them after 55 minutes (3300 seconds) to ensure we don't send using an expired token.
    if (Date.now() - tokenTime > 3300 * 1000) {
      clearAccessToken();
      return null;
    }
  }
  return token;
};

export const loginAnonymously = () => signInAnonymously(auth);
export const logout = () => {
  clearAccessToken();
  return signOut(auth);
};
