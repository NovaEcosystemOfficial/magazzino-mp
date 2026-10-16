import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseFirestore } from '../firebase/firestore'
import { isAppRole, type UserProfile } from '../types/auth'
import { normalizeUsername } from './usernameEmail'

/**
 * Legge il profilo da Firestore `users/{uid}`.
 * Il ruolo proviene solo da questo documento (non dalla UI, non da self-claim).
 */
export async function loadUserProfile(uid: string): Promise<UserProfile> {
  const snap = await getDoc(doc(getFirebaseFirestore(), 'users', uid))

  if (!snap.exists()) {
    throw new Error(
      'Profilo utente non trovato. Contattare l’amministratore per completare la configurazione dell’account.',
    )
  }

  const data = snap.data()
  const usernameRaw = typeof data.username === 'string' ? data.username : ''
  const username = normalizeUsername(usernameRaw)
  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName.trim()
      : username
  const role = data.role
  const active = data.active === true

  if (!username) {
    throw new Error('Profilo utente incompleto (username mancante). Contattare l’amministratore.')
  }
  if (!isAppRole(role)) {
    throw new Error('Ruolo utente non valido. Contattare l’amministratore.')
  }
  if (!active) {
    throw new Error('Account disattivato. Contattare l’amministratore.')
  }

  return {
    uid,
    username,
    displayName,
    role,
    active,
  }
}
