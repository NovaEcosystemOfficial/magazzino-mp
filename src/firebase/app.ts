import { initializeApp, type FirebaseApp } from 'firebase/app'

/**
 * Client Firebase Web (sola configurazione pubblica).
 * Non contiene service account né credenziali amministrative.
 * Auth / Firestore non vengono attivati qui: solo l’istanza App.
 */

function readFirebaseWebConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim() ?? ''
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? ''
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ?? ''
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ?? ''
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? ''
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim() ?? ''

  const missing = [
    !apiKey && 'VITE_FIREBASE_API_KEY',
    !authDomain && 'VITE_FIREBASE_AUTH_DOMAIN',
    !projectId && 'VITE_FIREBASE_PROJECT_ID',
    !storageBucket && 'VITE_FIREBASE_STORAGE_BUCKET',
    !messagingSenderId && 'VITE_FIREBASE_MESSAGING_SENDER_ID',
    !appId && 'VITE_FIREBASE_APP_ID',
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      `Configurazione Firebase incompleta. Imposta in .env.local: ${missing.join(', ')}.`,
    )
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  }
}

let appInstance: FirebaseApp | null = null

/** True se tutte le variabili VITE_FIREBASE_* pubbliche sono valorizzate. */
export function isFirebaseConfigured(): boolean {
  try {
    readFirebaseWebConfig()
    return true
  } catch {
    return false
  }
}

/** Istanza Firebase App (lazy). Non abilita Auth né Firestore. */
export function getFirebaseApp(): FirebaseApp {
  if (appInstance) {
    return appInstance
  }
  appInstance = initializeApp(readFirebaseWebConfig())
  return appInstance
}
