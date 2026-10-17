import type { ArticleRecord } from './articles'
import type { StockMovement } from './movements'

/**
 * Tipi documento Firestore per il magazzino cloud.
 * Fase 2B: usati dal modulo di sola lettura `src/cloud/warehouseRead.ts`.
 * Nessuna scrittura cloud; IndexedDB resta la sorgente ufficiale dell’app.
 */

export type CloudArticleDocument = ArticleRecord & {
  /** Id documento = chiave normalizzata articolo. */
  codeKey: string
  updatedAt?: string
  updatedByUid?: string
  /**
   * Versione ottimistica aggiornata ad ogni carico/scarico in transazione.
   * Mitiga conflitti multi-PC; non sostituisce un Callable Blaze per garanzia hard.
   */
  stockVersion?: number
}

/**
 * Movimento cloud: stesso payload IndexedDB + identità Auth obbligatoria.
 * L’identità affidabile è `performedByUid` (= Firebase Auth UID).
 */
export type CloudMovementDocument = StockMovement & {
  performedByUid: string
  performedByUsername: string
}

export const CLOUD_MOVEMENT_REQUIRED_KEYS = [
  'id',
  'type',
  'articleId',
  'articleCode',
  'quantity',
  'movementDate',
  'registeredAt',
  'supplier',
  'reason',
  'documentRef',
  'notes',
  'idempotencyKey',
  'performedByUid',
  'performedByUsername',
] as const

export type CloudMovementRequiredKey = (typeof CLOUD_MOVEMENT_REQUIRED_KEYS)[number]
