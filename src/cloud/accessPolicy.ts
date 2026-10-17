import { isBrandId, type BrandId } from '../brands/brands'
import type { AppRole, UserProfile } from '../types/auth'
import {
  CLOUD_MOVEMENT_REQUIRED_KEYS,
  type CloudMovementDocument,
} from '../types/cloudWarehouse'

/**
 * Specchio TypeScript della bozza `firestore.rules.cloud-warehouse.proposal`.
 * Usato solo per test / documentazione: le garanzie reali resteranno nelle Rules pubblicate.
 *
 * Nota: giacenza ≥ 0 contro client malevolo NON è imponibile con sole Rules;
 * contro PC onesti le transazioni client (registerCloud*) serializzano gli scarichi.
 */

export type AccessPrincipal = {
  uid: string | null
  profile: UserProfile | null
}

export function isSignedIn(principal: AccessPrincipal): boolean {
  return typeof principal.uid === 'string' && principal.uid.length > 0
}

export function isActiveOperatorOrAdmin(principal: AccessPrincipal): boolean {
  if (!isSignedIn(principal) || !principal.profile) {
    return false
  }
  if (principal.profile.uid !== principal.uid) {
    return false
  }
  if (!principal.profile.active) {
    return false
  }
  const role: AppRole = principal.profile.role
  return role === 'operator' || role === 'admin'
}

export function isActiveAdmin(principal: AccessPrincipal): boolean {
  return isActiveOperatorOrAdmin(principal) && principal.profile?.role === 'admin'
}

export function canAccessBrand(brandId: string): brandId is BrandId {
  return isBrandId(brandId)
}

export function canReadArticles(principal: AccessPrincipal, brandId: string): boolean {
  return isActiveOperatorOrAdmin(principal) && canAccessBrand(brandId)
}

export function canReadMovements(principal: AccessPrincipal, brandId: string): boolean {
  return isActiveOperatorOrAdmin(principal) && canAccessBrand(brandId)
}

/**
 * Movimenti: create consentito; update/delete sempre negati (anche admin).
 */
export function canCreateMovement(
  principal: AccessPrincipal,
  brandId: string,
  movement: CloudMovementDocument,
  documentId: string,
): boolean {
  if (!isActiveOperatorOrAdmin(principal) || !canAccessBrand(brandId)) {
    return false
  }
  if (!principal.uid) {
    return false
  }
  return isValidMovementCreatePayload(movement, documentId, principal.uid)
}

export function canUpdateMovement(
  _principal: AccessPrincipal,
  _brandId: string,
): boolean {
  return false
}

export function canDeleteMovement(
  _principal: AccessPrincipal,
  _brandId: string,
): boolean {
  return false
}

export function isValidMovementCreatePayload(
  movement: CloudMovementDocument,
  documentId: string,
  authUid: string,
): boolean {
  for (const key of CLOUD_MOVEMENT_REQUIRED_KEYS) {
    if (!(key in movement)) {
      return false
    }
  }
  if (movement.id !== documentId) {
    return false
  }
  if (movement.idempotencyKey !== documentId) {
    return false
  }
  if (movement.type !== 'CARICO' && movement.type !== 'SCARICO') {
    return false
  }
  if (!Number.isFinite(movement.quantity) || movement.quantity <= 0) {
    return false
  }
  if (!movement.articleId.trim() || !movement.articleCode.trim()) {
    return false
  }
  if (!movement.idempotencyKey.trim()) {
    return false
  }
  // Identità affidabile: solo UID Auth.
  if (movement.performedByUid !== authUid) {
    return false
  }
  if (typeof movement.performedByUsername !== 'string') {
    return false
  }
  return true
}

/**
 * Dichiarazione esplicita per test e specifica:
 * le sole Rules Firestore non garantiscono stock ≥ 0 sotto concorrenza multi-PC.
 */
export const NON_NEGATIVE_STOCK_MULTI_PC_GUARANTEED_BY_RULES = false

export const NON_NEGATIVE_STOCK_ATOMIC_REQUIRES_BACKEND_OR_BLAZE = true
