export type MovementType = 'CARICO'

export type StockMovement = {
  id: string
  type: MovementType
  /** Chiave stabile articolo (= codeKey IndexedDB). */
  articleId: string
  /** Codice articolo conservato come riferimento leggibile. */
  articleCode: string
  /** Quantità sempre positiva per CARICO. */
  quantity: number
  /** Data del movimento (YYYY-MM-DD, fuso locale). */
  movementDate: string
  /** Timestamp ISO di registrazione. */
  registeredAt: string
  supplier: string
  documentRef: string
  notes: string
  idempotencyKey: string
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
