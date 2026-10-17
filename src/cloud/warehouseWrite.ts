/**
 * Scritture magazzino Firestore (percorso Spark, senza Cloud Functions).
 *
 * CARICO/SCARICO: runTransaction su movimento (id=idempotencyKey) + currentStock/stockVersion.
 * Contro PC onesti: Firestore serializza le transazioni sullo stesso articolo.
 * Contro client malevolo: le Rules non possono impedire un bump inventato di currentStock;
 * per quella garanzia serve un backend Admin (Callable Blaze o API esterna gratuita).
 */

import {
  doc,
  runTransaction,
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import type { BrandId } from '../brands/brands'
import { getFirebaseAuth } from '../firebase/auth'
import { getFirebaseFirestore } from '../firebase/firestore'
import type { MovementActor } from '../types/actor'
import type { ArticleRecord } from '../types/articles'
import { normalizeArticleRecord } from '../types/articles'
import type { CaricoInput, ScaricoInput, StockMovement } from '../types/movements'
import { normalizeStockMovement } from '../types/movements'
import { formatQuantity, stockCoversQuantity } from '../utils/quantity'
import { parseNumericStock } from '../excel/articoliMapping'
import { parseCloudArticleDocument, parseCloudMovementDocument } from './parseCloudDocuments'
import {
  CLOUD_ARTICLES_COLLECTION,
  CLOUD_BRANDS_COLLECTION,
  CLOUD_MOVEMENTS_COLLECTION,
  assertCloudBrandId,
} from './paths'
import { listCloudArticles } from './warehouseRead'
import { mapWarehouseWriteError } from './mapWriteError'
import type { RegisterMovementResult } from '../storage/movementsDb'

function articleRef(db: Firestore, brandId: BrandId, codeKey: string) {
  return doc(db, CLOUD_BRANDS_COLLECTION, brandId, CLOUD_ARTICLES_COLLECTION, codeKey)
}

function movementRef(db: Firestore, brandId: BrandId, movementId: string) {
  return doc(db, CLOUD_BRANDS_COLLECTION, brandId, CLOUD_MOVEMENTS_COLLECTION, movementId)
}

function resolveActor(actor: MovementActor | undefined): MovementActor {
  const authUid = getFirebaseAuth().currentUser?.uid
  if (!authUid) {
    throw new Error('Operatore non autenticato: impossibile scrivere su Firestore.')
  }
  if (actor?.uid && actor.uid !== authUid) {
    throw new Error(
      'UID operatore non coerente con la sessione Auth. Operazione annullata.',
    )
  }
  return {
    uid: authUid,
    username: (actor?.username ?? '').trim() || authUid,
  }
}

function toArticlePayload(
  article: ArticleRecord,
  codeKey: string,
  extras: {
    currentStock: string
    stockVersion: number
    updatedByUid: string
  },
): Record<string, unknown> {
  return {
    code: article.code,
    codeKey,
    description: article.description,
    unitOfMeasure: article.unitOfMeasure,
    stock: article.stock,
    currentStock: extras.currentStock,
    status: article.status,
    category: article.category,
    supplier: article.supplier,
    minStock: article.minStock,
    totalReceived: article.totalReceived,
    sourceFields: article.sourceFields ?? {},
    stockVersion: extras.stockVersion,
    updatedAt: new Date().toISOString(),
    updatedByUid: extras.updatedByUid,
  }
}

function toMovementPayload(movement: StockMovement): Record<string, unknown> {
  return {
    id: movement.id,
    type: movement.type,
    articleId: movement.articleId,
    articleCode: movement.articleCode,
    quantity: movement.quantity,
    movementDate: movement.movementDate,
    registeredAt: movement.registeredAt,
    supplier: movement.supplier,
    reason: movement.reason,
    documentRef: movement.documentRef,
    notes: movement.notes,
    idempotencyKey: movement.idempotencyKey,
    performedByUid: movement.performedByUid ?? '',
    performedByUsername: movement.performedByUsername ?? '',
  }
}

async function readArticleInTx(
  tx: Transaction,
  db: Firestore,
  brandId: BrandId,
  articleId: string,
): Promise<{ article: ArticleRecord; stockVersion: number; codeKey: string }> {
  const snap = await tx.get(articleRef(db, brandId, articleId))
  if (!snap.exists()) {
    throw new Error(`Articolo inesistente: ${articleId}.`)
  }
  const data = snap.data() as Record<string, unknown>
  const parsed = parseCloudArticleDocument(snap.id, data)
  const stockVersion = typeof data.stockVersion === 'number' ? data.stockVersion : 0
  // Scrivere sempre sullo stesso doc id letto (non su un codeKey field eventualmente diverso).
  return {
    article: normalizeArticleRecord(parsed),
    stockVersion,
    codeKey: snap.id,
  }
}

function applyStockDelta(previousStock: string, delta: number): string {
  const previousValue = parseNumericStock(previousStock) ?? 0
  return formatQuantity(previousValue + delta)
}

export async function registerCloudCarico(
  input: CaricoInput,
  brandId: BrandId,
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<RegisterMovementResult> {
  const id = assertCloudBrandId(brandId)
  const path = `brands/${id}/movements`
  try {
    const performedBy = resolveActor(actor)
    const code = input.articleCode.trim()
    const articleId = code.toLowerCase()
    const idempotencyKey = input.idempotencyKey.trim()

    if (!code) throw new Error('Articolo non valido: codice mancante.')
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('La quantità deve essere numerica, finita e maggiore di zero.')
    }
    if (!input.supplier.trim()) throw new Error('Il fornitore è obbligatorio.')
    if (!input.documentRef.trim()) throw new Error('Il riferimento documento è obbligatorio.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.movementDate.trim())) {
      throw new Error('La data del movimento non è valida.')
    }
    if (!idempotencyKey) throw new Error('Chiave di idempotenza mancante.')

    return await runTransaction(db, async (tx) => {
      const movRef = movementRef(db, id, idempotencyKey)
      const existingMov = await tx.get(movRef)
      if (existingMov.exists()) {
        const movement = parseCloudMovementDocument(
          existingMov.id,
          existingMov.data() as Record<string, unknown>,
        )
        const { article } = await readArticleInTx(tx, db, id, articleId)
        return {
          movement: normalizeStockMovement(movement),
          previousStock: article.currentStock,
          newStock: article.currentStock,
          alreadyApplied: true,
        }
      }

      const { article, stockVersion, codeKey } = await readArticleInTx(tx, db, id, articleId)
      const previousStock = article.currentStock
      const newStockLabel = applyStockDelta(previousStock, input.quantity)

      const movement: StockMovement = {
        id: idempotencyKey,
        type: 'CARICO',
        articleId,
        articleCode: article.code,
        quantity: input.quantity,
        movementDate: input.movementDate.trim(),
        registeredAt: new Date().toISOString(),
        supplier: input.supplier.trim(),
        reason: '',
        documentRef: input.documentRef.trim(),
        notes: input.notes.trim(),
        idempotencyKey,
        performedByUid: performedBy.uid,
        performedByUsername: performedBy.username,
      }

      tx.set(movRef, toMovementPayload(movement))
      // Solo campi giacenza: merge minimale → code/codeKey/stock restano quelli del resource (rules).
      tx.set(
        articleRef(db, id, codeKey),
        {
          currentStock: newStockLabel,
          stockVersion: stockVersion + 1,
          updatedAt: new Date().toISOString(),
          updatedByUid: performedBy.uid,
        },
        { merge: true },
      )

      return {
        movement: normalizeStockMovement(movement),
        previousStock,
        newStock: newStockLabel,
        alreadyApplied: false,
      }
    })
  } catch (error) {
    throw mapWarehouseWriteError(error, { brandId: id, path })
  }
}

export async function registerCloudScarico(
  input: ScaricoInput,
  brandId: BrandId,
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<RegisterMovementResult> {
  const id = assertCloudBrandId(brandId)
  const path = `brands/${id}/movements`
  try {
    const performedBy = resolveActor(actor)
    const code = input.articleCode.trim()
    const articleId = code.toLowerCase()
    const idempotencyKey = input.idempotencyKey.trim()

    if (!code) throw new Error('Articolo non valido: codice mancante.')
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('La quantità deve essere numerica, finita e maggiore di zero.')
    }
    if (!input.reason.trim()) throw new Error('La causale è obbligatoria.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.movementDate.trim())) {
      throw new Error('La data del movimento non è valida.')
    }
    if (!idempotencyKey) throw new Error('Chiave di idempotenza mancante.')

    return await runTransaction(db, async (tx) => {
      const movRef = movementRef(db, id, idempotencyKey)
      const existingMov = await tx.get(movRef)
      if (existingMov.exists()) {
        const movement = parseCloudMovementDocument(
          existingMov.id,
          existingMov.data() as Record<string, unknown>,
        )
        const { article } = await readArticleInTx(tx, db, id, articleId)
        return {
          movement: normalizeStockMovement(movement),
          previousStock: article.currentStock,
          newStock: article.currentStock,
          alreadyApplied: true,
        }
      }

      const { article, stockVersion, codeKey } = await readArticleInTx(tx, db, id, articleId)
      const previousStock = article.currentStock

      // In cloud Spark: niente overdraft (anche se la UI lo chiede).
      if (!stockCoversQuantity(previousStock, input.quantity)) {
        throw new Error(
          `Quantità superiore alla giacenza disponibile (${previousStock}). Scarico rifiutato.`,
        )
      }

      const newStockLabel = applyStockDelta(previousStock, -input.quantity)

      const movement: StockMovement = {
        id: idempotencyKey,
        type: 'SCARICO',
        articleId,
        articleCode: article.code,
        quantity: input.quantity,
        movementDate: input.movementDate.trim(),
        registeredAt: new Date().toISOString(),
        supplier: '',
        reason: input.reason.trim(),
        documentRef: input.documentRef.trim(),
        notes: input.notes.trim(),
        idempotencyKey,
        performedByUid: performedBy.uid,
        performedByUsername: performedBy.username,
      }

      tx.set(movRef, toMovementPayload(movement))
      tx.set(
        articleRef(db, id, codeKey),
        {
          currentStock: newStockLabel,
          stockVersion: stockVersion + 1,
          updatedAt: new Date().toISOString(),
          updatedByUid: performedBy.uid,
        },
        { merge: true },
      )

      return {
        movement: normalizeStockMovement(movement),
        previousStock,
        newStock: newStockLabel,
        alreadyApplied: false,
      }
    })
  } catch (error) {
    throw mapWarehouseWriteError(error, { brandId: id, path })
  }
}

/** Import Excel anagrafica: create con stockVersion 0; update senza toccare giacenza. */
export async function persistCloudArticles(
  articles: ArticleRecord[],
  brandId: BrandId,
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<{
  added: ArticleRecord[]
  skippedExisting: ArticleRecord[]
  enrichedExisting: ArticleRecord[]
  totalAfter: number
}> {
  const id = assertCloudBrandId(brandId)
  const path = `brands/${id}/articles`
  try {
    const performedBy = resolveActor(actor)
    const added: ArticleRecord[] = []
    const skippedExisting: ArticleRecord[] = []
    const enrichedExisting: ArticleRecord[] = []

    for (const raw of articles) {
      const code = raw.code.trim()
      if (!code) continue
      const codeKey = code.toLowerCase()
      const ref = articleRef(db, id, codeKey)

      const outcome = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) {
          const article = normalizeArticleRecord({ ...raw, code })
          tx.set(
            ref,
            toArticlePayload(article, codeKey, {
              currentStock: article.currentStock,
              stockVersion: 0,
              updatedByUid: performedBy.uid,
            }),
          )
          return { kind: 'added' as const, article }
        }

        const existing = parseCloudArticleDocument(
          snap.id,
          snap.data() as Record<string, unknown>,
        )
        const blank = (v: string) => !v.trim() || v.trim() === '—'
        const prefer = (cur: string, inc: string) =>
          !blank(cur) ? cur : !blank(inc) ? inc : '—'
        const incoming = normalizeArticleRecord({ ...raw, code: existing.code })
        const data = snap.data() as { stockVersion?: number }
        const stockVersion = typeof data.stockVersion === 'number' ? data.stockVersion : 0

        const merged = normalizeArticleRecord({
          code: existing.code,
          description: prefer(existing.description, incoming.description),
          unitOfMeasure: prefer(existing.unitOfMeasure, incoming.unitOfMeasure),
          // Giacenza iniziale e corrente: non toccare in enrich (rules / Spark).
          stock: existing.stock,
          currentStock: existing.currentStock,
          status: prefer(existing.status, incoming.status),
          category: prefer(existing.category, incoming.category),
          supplier: prefer(existing.supplier, incoming.supplier),
          minStock: prefer(existing.minStock, incoming.minStock),
          totalReceived: prefer(existing.totalReceived, incoming.totalReceived),
          sourceFields: { ...existing.sourceFields, ...incoming.sourceFields },
        })

        if (JSON.stringify(normalizeArticleRecord(existing)) === JSON.stringify(merged)) {
          return { kind: 'skipped' as const, article: normalizeArticleRecord(existing) }
        }

        tx.set(
          ref,
          toArticlePayload(merged, codeKey, {
            currentStock: existing.currentStock,
            stockVersion,
            updatedByUid: performedBy.uid,
          }),
          { merge: true },
        )
        return { kind: 'enriched' as const, article: merged }
      })

      if (outcome.kind === 'added') added.push(outcome.article)
      else if (outcome.kind === 'skipped') skippedExisting.push(outcome.article)
      else enrichedExisting.push(outcome.article)
    }

    const totalAfter = (await listCloudArticles(id, { db })).length
    return { added, skippedExisting, enrichedExisting, totalAfter }
  } catch (error) {
    throw mapWarehouseWriteError(error, { brandId: id, path })
  }
}
