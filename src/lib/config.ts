export const AppConfig = {
  CREDITOR_PASSWORD: import.meta.env.VITE_CREDITOR_PASSWORD || 'CREDIT2026',
  BORROWER_PASSWORD: import.meta.env.VITE_BORROWER_PASSWORD || 'LOAN2026',
  APP_PASSWORD: import.meta.env.VITE_APP_PASSWORD || 'Credits100',
  FIREBASE_CONFIG: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
  }
};
