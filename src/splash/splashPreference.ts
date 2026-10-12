/** Preferenza UI: non tocca IndexedDB né i dati di magazzino. */
export const SPLASH_SEEN_STORAGE_KEY = 'magazzino-mp-splash-seen'

export function hasSeenSplashScreen(): boolean {
  try {
    return window.localStorage.getItem(SPLASH_SEEN_STORAGE_KEY) === '1'
  } catch {
    // Se localStorage non è disponibile, non bloccare l’ingresso al gestionale.
    return true
  }
}

export function markSplashScreenSeen(): void {
  try {
    window.localStorage.setItem(SPLASH_SEEN_STORAGE_KEY, '1')
  } catch {
    // Preferenza non persistita: al prossimo avvio lo splash potrà ricomparire.
  }
}

/** Solo per test: riattiva lo splash senza cancellare articoli/movimenti. */
export function resetSplashScreenPreference(): void {
  try {
    window.localStorage.removeItem(SPLASH_SEEN_STORAGE_KEY)
  } catch {
    // Ignora: la preferenza non è critica per i dati.
  }
}
