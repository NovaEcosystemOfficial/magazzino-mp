/** Dominio tecnico interno — non mostrato in UI, non è una casella email reale. */
export const USERNAME_EMAIL_DOMAIN = 'users.magazzino-mp.internal'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}$/

/** Normalizza lo username (trim + minuscolo). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Valida lo username operativo.
 * @returns messaggio di errore in italiano, oppure null se valido.
 */
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (!username) {
    return 'Inserire il nome utente.'
  }
  if (username.length < 3) {
    return 'Il nome utente deve avere almeno 3 caratteri.'
  }
  if (username.length > 32) {
    return 'Il nome utente non può superare 32 caratteri.'
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Nome utente non valido. Usare lettere minuscole, numeri, punto, trattino o underscore.'
  }
  if (username.includes('..') || username.startsWith('.') || username.endsWith('.')) {
    return 'Nome utente non valido.'
  }
  return null
}

/**
 * Conversione deterministica username → identificatore email tecnico per Firebase Auth.
 * Stesso username produce sempre la stessa email.
 */
export function usernameToAuthEmail(raw: string): string {
  const username = normalizeUsername(raw)
  const error = validateUsername(username)
  if (error) {
    throw new Error(error)
  }
  return `${username}@${USERNAME_EMAIL_DOMAIN}`
}
