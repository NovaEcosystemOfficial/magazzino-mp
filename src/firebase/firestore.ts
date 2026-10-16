import { getFirestore, type Firestore } from 'firebase/firestore'
import { getFirebaseApp } from './app'

let firestoreInstance: Firestore | null = null

export function getFirebaseFirestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(getFirebaseApp())
  }
  return firestoreInstance
}
