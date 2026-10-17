import { normalizeArticleRecord } from '../types/articles'
import { normalizeStockMovement } from '../types/movements'
import type { CloudArticleDocument, CloudMovementDocument } from '../types/cloudWarehouse'
import { CloudWarehouseReadError } from './firestoreReadErrors'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asSourceFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      out[key] = raw
    }
  }
  return out
}

/**
 * Converte un documento Firestore articolo in modello tipizzato.
 * Non scrive sul cloud.
 */
export function parseCloudArticleDocument(
  docId: string,
  data: Record<string, unknown>,
): CloudArticleDocument {
  const code = asString(data.code).trim() || docId
  if (!code.trim()) {
    throw new CloudWarehouseReadError(
      'invalid-argument',
      `Documento articolo senza code (id=${docId}).`,
      { path: docId },
    )
  }

  const article = normalizeArticleRecord({
    code,
    description: asString(data.description),
    unitOfMeasure: asString(data.unitOfMeasure),
    stock: asString(data.stock),
    currentStock: asString(data.currentStock),
    status: asString(data.status),
    category: asString(data.category),
    supplier: asString(data.supplier),
    minStock: asString(data.minStock),
    totalReceived: asString(data.totalReceived),
    sourceFields: asSourceFields(data.sourceFields),
  })

  const codeKey = asString(data.codeKey).trim() || article.code.trim().toLowerCase()
  const updatedAt = asString(data.updatedAt).trim() || undefined
  const updatedByUid = asString(data.updatedByUid).trim() || undefined

  return {
    ...article,
    codeKey,
    ...(updatedAt ? { updatedAt } : {}),
    ...(updatedByUid ? { updatedByUid } : {}),
  }
}

/**
 * Converte un documento Firestore movimento in modello tipizzato.
 * Accetta anche documenti “minimi” (pre-migrazione) senza performedBy*:
 * in quel caso i campi restano stringa vuota (sola lettura / diagnostica).
 */
export function parseCloudMovementDocument(
  docId: string,
  data: Record<string, unknown>,
): CloudMovementDocument {
  const id = asString(data.id).trim() || docId
  const articleId = asString(data.articleId).trim()
  const articleCode = asString(data.articleCode).trim()
  const idempotencyKey = asString(data.idempotencyKey).trim() || id
  const quantityRaw = data.quantity
  const quantity =
    typeof quantityRaw === 'number'
      ? quantityRaw
      : typeof quantityRaw === 'string'
        ? Number(quantityRaw)
        : NaN

  if (!articleId || !articleCode) {
    throw new CloudWarehouseReadError(
      'invalid-argument',
      `Movimento incompleto (id=${docId}): articleId/articleCode mancanti.`,
      { path: docId },
    )
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new CloudWarehouseReadError(
      'invalid-argument',
      `Movimento incompleto (id=${docId}): quantity non valida.`,
      { path: docId },
    )
  }

  const base = normalizeStockMovement({
    id,
    type: data.type === 'SCARICO' ? 'SCARICO' : 'CARICO',
    articleId,
    articleCode,
    quantity,
    movementDate: asString(data.movementDate),
    registeredAt: asString(data.registeredAt),
    supplier: asString(data.supplier),
    reason: asString(data.reason),
    documentRef: asString(data.documentRef),
    notes: asString(data.notes),
    idempotencyKey,
  })

  return {
    ...base,
    performedByUid: asString(data.performedByUid),
    performedByUsername: asString(data.performedByUsername),
  }
}
