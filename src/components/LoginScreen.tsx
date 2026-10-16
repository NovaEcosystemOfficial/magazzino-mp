import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'

/**
 * Accesso operativo: solo username + password.
 * Nessuna registrazione pubblica; account creati dall’amministratore (Console).
 */
export function LoginScreen() {
  const { signIn, errorMessage, clearError, status } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const busy = submitting || status === 'loading'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()
    setSubmitting(true)
    try {
      await signIn(username, password)
    } catch {
      // Il messaggio in italiano è già in AuthContext.errorMessage.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen" role="main" aria-labelledby="login-title">
      <div className="login-screen__card login-screen__animate">
        <div className="login-screen__logo" aria-hidden="true">
          <span className="splash-screen__logo-mark">MP</span>
        </div>

        <p className="login-screen__eyebrow">Magazzino MP — Gestione Materie Prime</p>
        <h1 id="login-title" className="login-screen__title">
          Accedi
        </h1>
        <p className="login-screen__subtitle">
          Inserire le credenziali fornite dall’amministratore. Non è prevista la registrazione
          autonoma.
        </p>

        <form className="login-screen__form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span className="field__label">Nome utente</span>
            <input
              className="field__control"
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
              required
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__control"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              required
            />
          </label>

          {errorMessage ? (
            <div className="alert alert--error" role="alert">
              <p>{errorMessage}</p>
            </div>
          ) : null}

          <button
            type="submit"
            className="primary-button primary-button--cta login-screen__submit"
            disabled={busy}
          >
            {busy ? 'Accesso in corso…' : 'Accedi'}
          </button>
        </form>

        <p className="login-screen__footnote">
          Archivio locale sul dispositivo · autenticazione Firebase
        </p>
      </div>
    </div>
  )
}
