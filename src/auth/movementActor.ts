import type { User } from 'firebase/auth'
import type { MovementActor } from '../types/actor'
import type { UserProfile } from '../types/auth'

/** Costruisce l’attore movimento da Auth + profilo Firestore (ruolo non dal client). */
export function movementActorFromAuth(
  user: User | null | undefined,
  profile: UserProfile | null | undefined,
): MovementActor | undefined {
  if (!user?.uid) {
    return undefined
  }
  return {
    uid: user.uid,
    username: profile?.username?.trim() || user.email?.split('@')[0] || user.uid,
  }
}
