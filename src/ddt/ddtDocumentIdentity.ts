import type { StockMovement } from '../types/movements'

export type DdtDocumentIdentity = {
  documentNumber: string
  supplier: string
  documentDateIso: string
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Firma stabile del documento: numero DDT + fornitore + data. */
export function buildDdtDocumentFingerprint(identity: DdtDocumentIdentity): string {
  return [
    normalizeKeyPart(identity.documentNumber),
    normalizeKeyPart(identity.supplier),
    normalizeKeyPart(identity.documentDateIso),
  ].join('|')
}

export function movementMatchesDdtDocument(
  movement: Pick<StockMovement, 'type' | 'documentRef' | 'supplier' | 'movementDate'>,
  identity: DdtDocumentIdentity,
): boolean {
  if (movement.type !== 'CARICO') {
    return false
  }
  return (
    buildDdtDocumentFingerprint({
      documentNumber: movement.documentRef,
      supplier: movement.supplier,
      documentDateIso: movement.movementDate,
    }) === buildDdtDocumentFingerprint(identity)
  )
}

export function findMovementsForDdtDocument(
  movements: StockMovement[],
  identity: DdtDocumentIdentity,
): StockMovement[] {
  if (
    !identity.documentNumber.trim() ||
    !identity.supplier.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(identity.documentDateIso.trim())
  ) {
    return []
  }
  return movements.filter((movement) => movementMatchesDdtDocument(movement, identity))
}

export function formatDdtAlreadyRegisteredMessage(
  identity: DdtDocumentIdentity,
  existingCount: number,
): string {
  const number = identity.documentNumber.trim()
  const supplier = identity.supplier.trim()
  const date = identity.documentDateIso.trim()
  return (
    `DDT già registrato: ${number} del ${date}, fornitore ${supplier} ` +
    `(${existingCount} carico/i in storico). Nessuna nuova registrazione e nessuna modifica alle giacenze.`
  )
}
