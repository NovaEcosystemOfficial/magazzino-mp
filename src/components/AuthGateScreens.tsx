type AuthLoadingScreenProps = {
  message?: string
}

export function AuthLoadingScreen({ message = 'Verifica sessione…' }: AuthLoadingScreenProps) {
  return (
    <div className="login-screen" role="status" aria-live="polite">
      <div className="login-screen__card">
        <div className="login-screen__logo" aria-hidden="true">
          <span className="splash-screen__logo-mark">MP</span>
        </div>
        <h1 className="login-screen__title">Magazzino MP</h1>
        <p className="login-screen__subtitle">{message}</p>
      </div>
    </div>
  )
}

type AuthMisconfiguredScreenProps = {
  message: string
}

export function AuthMisconfiguredScreen({ message }: AuthMisconfiguredScreenProps) {
  return (
    <div className="login-screen" role="alert">
      <div className="login-screen__card">
        <div className="login-screen__logo" aria-hidden="true">
          <span className="splash-screen__logo-mark">MP</span>
        </div>
        <h1 className="login-screen__title">Configurazione richiesta</h1>
        <div className="alert alert--error">
          <p>{message}</p>
        </div>
      </div>
    </div>
  )
}
