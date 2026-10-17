import type { BrandId } from '../brands/brands'
import type { MovementActor } from '../types/actor'
import {
  formatDdtAlreadyRegisteredMessage,
  type DdtDocumentIdentity,
} from './ddtDocumentIdentity'
import { claimCloudDdtDocument } from '../cloud/ddtClaim'
import { isCloudWarehouseActive } from '../storage/dataSource'
import {
  findCarichiForDdtDocument,
  registerCarico,
  type RegisterCaricoResult,
} from '../storage/warehouseRepository'
import type { DdtEditableRow, DdtHeaderFields, DdtImportSummary } from '../types/ddt'

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Chiave di idempotenza per riga, ancorata all’identità documento
 * (numero + fornitore + data) e indipendente dal testo OCR / nome file.
 */
export function buildDdtRowIdempotencyKey(input: {
  documentNumber: string
  supplier: string
  documentDateIso: string
  lineNumber: number
  articleCode: string
  quantity: number
}): string {
  return [
    'ddt-row',
    normalizeKeyPart(input.documentNumber || 'nodoc'),
    normalizeKeyPart(input.supplier || 'nosupplier'),
    normalizeKeyPart(input.documentDateIso || 'nodate'),
    `line:${input.lineNumber}`,
    normalizeKeyPart(input.articleCode),
    String(input.quantity),
  ].join('|')
}

export type DdtRegistrationInput = {
  fileName: string
  header: DdtHeaderFields
  rows: DdtEditableRow[]
  /** Archivio brand su cui registrare i carichi (obbligatorio per isolamento). */
  brandId: BrandId
  /** Obbligatorio in modalità Firestore. */
  actor?: MovementActor
}

export type DdtRegistrationResult = {
  summary: DdtImportSummary
  results: RegisterCaricoResult[]
}

export function getRegistrableRows(rows: DdtEditableRow[]): {
  registrable: DdtEditableRow[]
  blocked: { row: DdtEditableRow; reason: string }[]
} {
  const registrable: DdtEditableRow[] = []
  const blocked: { row: DdtEditableRow; reason: string }[] = []

  for (const row of rows) {
    if (!row.included) {
      continue
    }
    if (!row.matchedArticleCode || row.matchStatus !== 'matched') {
      blocked.push({ row, reason: `Riga ${row.lineNumber}: articolo da verificare.` })
      continue
    }
    if (row.quantity === null || !(row.quantity > 0)) {
      blocked.push({ row, reason: `Riga ${row.lineNumber}: quantità mancante o non valida.` })
      continue
    }
    registrable.push(row)
  }

  return { registrable, blocked }
}

export function headerToDdtIdentity(header: DdtHeaderFields): DdtDocumentIdentity {
  return {
    documentNumber: header.documentNumber.trim(),
    supplier: header.supplier.trim(),
    documentDateIso: header.documentDateIso.trim(),
  }
}

/**
 * Registra i carichi solo per le righe valide, una per una, con idempotenza.
 * Prima di qualsiasi scrittura verifica se lo stesso DDT (numero+fornitore+data)
 * è già presente nello storico, anche dopo associazioni manuali.
 */
export async function registerDdtCarichi(
  input: DdtRegistrationInput,
): Promise<DdtRegistrationResult> {
  const identity = headerToDdtIdentity(input.header)
  const { documentNumber, documentDateIso, supplier } = identity

  if (!documentNumber) {
    throw new Error('Numero DDT obbligatorio prima della registrazione.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDateIso)) {
    throw new Error('Data DDT non valida.')
  }
  if (!supplier) {
    throw new Error('Fornitore obbligatorio prima della registrazione.')
  }

  const brandId = input.brandId
  const existingForDocument = await findCarichiForDdtDocument(identity, brandId)
  if (existingForDocument.length > 0) {
    const message = formatDdtAlreadyRegisteredMessage(identity, existingForDocument.length)
    return {
      summary: {
        fileName: input.fileName,
        documentNumber,
        documentDateIso,
        supplier,
        registered: 0,
        skippedAlreadyApplied: existingForDocument.length,
        excluded: input.rows.filter((row) => !row.included).length,
        messages: [message],
        alreadyRegisteredDocument: true,
      },
      results: [],
    }
  }

  // Cloud: claim create-only anti-race multi-PC sullo stesso DDT.
  if (isCloudWarehouseActive()) {
    if (!input.actor?.uid) {
      throw new Error('Registrazione DDT cloud richiede utente autenticato.')
    }
    const claim = await claimCloudDdtDocument(brandId, identity, input.actor)
    if (claim.alreadyClaimed) {
      const message = formatDdtAlreadyRegisteredMessage(identity, 1)
      return {
        summary: {
          fileName: input.fileName,
          documentNumber,
          documentDateIso,
          supplier,
          registered: 0,
          skippedAlreadyApplied: 1,
          excluded: input.rows.filter((row) => !row.included).length,
          messages: [`${message} (claim cloud già presente).`],
          alreadyRegisteredDocument: true,
        },
        results: [],
      }
    }
  }

  const { registrable, blocked } = getRegistrableRows(input.rows)
  if (registrable.length === 0) {
    throw new Error(
      blocked[0]?.reason ??
        'Nessuna riga valida da registrare. Completare associazioni e quantità.',
    )
  }
  if (blocked.length > 0) {
    throw new Error(
      `Ci sono ancora ${blocked.length} riga/e non registrabili (incluse). ${blocked[0].reason}`,
    )
  }

  const results: RegisterCaricoResult[] = []
  let registered = 0
  let skippedAlreadyApplied = 0
  const messages: string[] = []

  for (const row of registrable) {
    const idempotencyKey = buildDdtRowIdempotencyKey({
      documentNumber,
      supplier,
      documentDateIso,
      lineNumber: row.lineNumber,
      articleCode: row.matchedArticleCode!,
      quantity: row.quantity!,
    })

    const notesParts = [
      `Importazione DDT ${documentNumber}`,
      row.description ? `Descr. DDT: ${row.description}` : '',
      row.manualNotes.trim() ? `Note: ${row.manualNotes.trim()}` : '',
    ].filter(Boolean)

    const result = await registerCarico(
      {
        articleCode: row.matchedArticleCode!,
        quantity: row.quantity!,
        movementDate: documentDateIso,
        supplier,
        documentRef: documentNumber,
        notes: notesParts.join(' · '),
        idempotencyKey,
      },
      brandId,
      input.actor,
    )

    results.push(result)
    if (result.alreadyApplied) {
      skippedAlreadyApplied += 1
      messages.push(
        `Riga ${row.lineNumber} (${result.movement.articleCode}): già registrata in precedenza.`,
      )
    } else {
      registered += 1
      messages.push(
        `Riga ${row.lineNumber}: carico ${result.movement.quantity} su ${result.movement.articleCode} (${result.previousStock} → ${result.newStock}).`,
      )
    }
  }

  const excluded = input.rows.filter((row) => !row.included).length

  return {
    summary: {
      fileName: input.fileName,
      documentNumber,
      documentDateIso,
      supplier,
      registered,
      skippedAlreadyApplied,
      excluded,
      messages,
      alreadyRegisteredDocument: false,
    },
    results,
  }
}
