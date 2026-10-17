export type MovementType = 'CARICO' | 'SCARICO'

export const SCARICO_REASONS = [
  'Prelievo interno',
  'Utilizzo produzione',
  'Reso al fornitore',
  'Altro',
] as const

export type ScaricoReason = (typeof SCARICO_REASONS)[number]

export type StockMovement = {
  id: string
  type: MovementType
  /** Chiave stabile articolo (= codeKey IndexedDB). */
  articleId: string
  /** Codice articolo conservato come riferimento leggibile. */
  articleCode: string
  /** Quantità sempre positiva (segno determinato da type). */
  quantity: number
  /** Data del movimento (YYYY-MM-DD, fuso locale). */
  movementDate: string
  /** Timestamp ISO di registrazione. */
  registeredAt: string
  /** Fornitore (tipico dei CARICO). Per SCARICO può essere vuoto. */
  supplier: string
  /** Causale operativa (tipica degli SCARICO). Per CARICO può essere vuota. */
  reason: string
  documentRef: string
  notes: string
  idempotencyKey: string
  /** UID Firebase Auth (obbligatorio in cloud; opzionale in IndexedDB legacy). */
  performedByUid?: string
  /** Username denormalizzato (solo display). */
  performedByUsername?: string
}

export type CaricoInput = {
  articleCode: string
  quantity: number
  movementDate: string
  supplier: string
  documentRef: string
  notes: string
  idempotencyKey: string
}

export type ScaricoInput = {
  articleCode: string
  quantity: number
  movementDate: string
  reason: string
  documentRef: string
  notes: string
  idempotencyKey: string
  /** Se true, consente quantità superiore alla giacenza (autorizzazione esplicita). */
  allowOverdraft: boolean
}

/** Normalizza record legacy senza campo reason. */
export function normalizeStockMovement(
  raw: Partial<StockMovement> &
    Pick<
      StockMovement,
      | 'id'
      | 'type'
      | 'articleId'
      | 'articleCode'
      | 'quantity'
      | 'movementDate'
      | 'registeredAt'
      | 'documentRef'
      | 'notes'
      | 'idempotencyKey'
    >,
): StockMovement {
  return {
    id: raw.id,
    type: raw.type === 'SCARICO' ? 'SCARICO' : 'CARICO',
    articleId: raw.articleId,
    articleCode: raw.articleCode,
    quantity: raw.quantity,
    movementDate: raw.movementDate,
    registeredAt: raw.registeredAt,
    supplier: typeof raw.supplier === 'string' ? raw.supplier : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    documentRef: raw.documentRef,
    notes: raw.notes,
    idempotencyKey: raw.idempotencyKey,
    ...(typeof raw.performedByUid === 'string' && raw.performedByUid
      ? { performedByUid: raw.performedByUid }
      : {}),
    ...(typeof raw.performedByUsername === 'string'
      ? { performedByUsername: raw.performedByUsername }
      : {}),
  }
}
