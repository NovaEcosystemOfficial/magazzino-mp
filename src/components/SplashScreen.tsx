type SplashScreenProps = {
  onEnter: () => void
}

/**
 * Schermata introduttiva. Usa il marchio grafico già presente nell’app
 * (nessun file logo aggiuntivo nel progetto).
 */
export function SplashScreen({ onEnter }: SplashScreenProps) {
  return (
    <div className="splash-screen" role="main" aria-labelledby="splash-title">
      <div className="splash-screen__card splash-screen__animate">
        <div className="splash-screen__logo" aria-hidden="true">
          <span className="splash-screen__logo-mark" />
        </div>

        <h1 id="splash-title" className="splash-screen__title">
          Magazzino MP
        </h1>
        <p className="splash-screen__subtitle">Gestione Materie Prime</p>

        <button type="button" className="primary-button splash-screen__cta" onClick={onEnter}>
          Entra nel gestionale
        </button>

        <p className="splash-screen__hint">Archivio locale · dati sul dispositivo</p>
      </div>
    </div>
  )
}
