/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  /** Preferenza sorgente: indexeddb (default) | firestore. */
  readonly VITE_DATA_SOURCE?: string
  /** true solo dopo readiness cloud (rules + migrazione). Default assente/false. */
  readonly VITE_CLOUD_WAREHOUSE_ENABLED?: string
  /** true = percorso opzionale Callable Blaze; false/assente = Spark client txs. */
  readonly VITE_USE_STOCK_CALLABLE?: string
  /** true per puntare all’emulator Functions in locale. */
  readonly VITE_FUNCTIONS_EMULATOR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
