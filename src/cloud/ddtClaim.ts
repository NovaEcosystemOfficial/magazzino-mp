/**
 * Claim create-only per DDT (anti-race multi-PC sullo stesso documento).
 * Path: brands/{brandId}/ddtClaims/{claimId}
 */

import { doc, runTransaction, type Firestore } from 'firebase/firestore'
import type { BrandId } from '../brands/brands'
import type { DdtDocumentIdentity } from '../ddt/ddtDocumentIdentity'
import { getFirebaseAuth } from '../firebase/auth'
import { getFirebaseFirestore } from '../firebase/firestore'
import type { MovementActor } from '../types/actor'
import { CLOUD_BRANDS_COLLECTION, assertCloudBrandId } from './paths'

export const CLOUD_DDT_CLAIMS_COLLECTION = 'ddtClaims'

function normalizeClaimPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function buildDdtClaimId(identity: DdtDocumentIdentity): string {
  const id = [
    normalizeClaimPart(identity.documentNumber),
    normalizeClaimPart(identity.supplier),
    normalizeClaimPart(identity.documentDateIso),
  ].join('__')
  if (!id.replace(/_/g, '').length) {
    throw new Error('Identità DDT incompleta per il claim cloud.')
  }
  // Limite pratico id documento Firestore.
  return id.slice(0, 700)
}

/**
 * Crea il claim se assente. Ritorna alreadyClaimed=true se già presente.
 * Non aggiorna né cancella claim esistenti.
 */
export async function claimCloudDdtDocument(
  brandId: BrandId,
  identity: DdtDocumentIdentity,
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<{ claimId: string; alreadyClaimed: boolean }> {
  const id = assertCloudBrandId(brandId)
  const claimId = buildDdtClaimId(identity)
  const ref = doc(db, CLOUD_BRANDS_COLLECTION, id, CLOUD_DDT_CLAIMS_COLLECTION, claimId)

  const authUid = getFirebaseAuth().currentUser?.uid
  if (!authUid) {
    throw new Error('Operatore non autenticato: impossibile creare il claim DDT.')
  }
  if (actor.uid && actor.uid !== authUid) {
    throw new Error('UID operatore non coerente con la sessione Auth. Claim DDT annullato.')
  }

  const alreadyClaimed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists()) {
      return true
    }
    // claimedByUid deve coincidere con Auth (rules); non usare un uid client arbitrario.
    tx.set(ref, {
      documentNumber: identity.documentNumber.trim(),
      supplier: identity.supplier.trim(),
      documentDateIso: identity.documentDateIso.trim(),
      claimedAt: new Date().toISOString(),
      claimedByUid: authUid,
      claimedByUsername: (actor.username ?? '').trim() || authUid,
    })
    return false
  })

  return { claimId, alreadyClaimed }
}
