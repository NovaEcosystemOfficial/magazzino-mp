import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
  type Unsubscribe,
} from 'firebase/auth'
import { usernameToAuthEmail, validateUsername } from '../auth/usernameEmail'
import { getFirebaseApp } from './app'

let authInstance: Auth | null = null

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp())
  }
  return authInstance
}

export function subscribeToAuthState(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getFirebaseAuth(), callback)
}

/** Login con username operativo (convertito in email tecnica, non mostrata in UI). */
export async function signInWithUsernamePassword(
  username: string,
  password: string,
): Promise<User> {
  const validationError = validateUsername(username)
  if (validationError) {
    throw new Error(validationError)
  }
  if (!password) {
    throw new Error('Inserire la password.')
  }

  const email = usernameToAuthEmail(username)
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
  return credential.user
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut(getFirebaseAuth())
}
