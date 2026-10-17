import { CloudWarehouseReadError, mapFirestoreReadError } from './firestoreReadErrors'
import type { BrandId } from '../brands/brands'

/** Normalizza errori di scrittura Firestore (rete, permission, precondition). */
export function mapWarehouseWriteError(
  error: unknown,
  context: { brandId: BrandId; path: string },
): Error {
  if (error instanceof CloudWarehouseReadError) {
    return error
  }
  if (error instanceof Error && !('code' in error)) {
    // Errori di validazione applicativa: lascia messaggio originale.
    const msg = error.message
    if (
      msg.includes('Articolo') ||
      msg.includes('quantità') ||
      msg.includes('Quantità') ||
      msg.includes('fornitore') ||
      msg.includes('causale') ||
      msg.includes('idempotenza') ||
      msg.includes('autenticat') ||
      msg.includes('DDT') ||
      msg.includes('Giacenza')
    ) {
      return error
    }
  }
  return mapFirestoreReadError(error, context)
}
