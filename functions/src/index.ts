/**
 * Cloud Functions — Magazzino MP
 *
 * registerWarehouseMovement: unico percorso autorizzato per carichi/scarichi cloud.
 * importBrandSnapshot: migrazione admin (scritture Admin SDK; il client non può creare movimenti).
 *
 * NON deployato da questa repo. Richiede piano Blaze.
 * Region: europe-west1 (allineata al client).
 */

import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'

initializeApp()
setGlobalOptions({ region: 'europe-west1' })

type MovementType = 'CARICO' | 'SCARICO'

type RegisterPayload = {
  brandId: string
  type: MovementType
  articleCode: string
  quantity: number
  movementDate: string
  supplier?: string
  reason?: string
  documentRef?: string
  notes?: string
  idempotencyKey: string
  /** Ignorato: in cloud gli scarichi sotto zero sono sempre rifiutati. */
  allowOverdraft?: boolean
}

type SnapshotArticle = {
  code: string
  description?: string
  unitOfMeasure?: string
  stock?: string
  currentStock?: string
  status?: string
  category?: string
  supplier?: string
  minStock?: string
  totalReceived?: string
  sourceFields?: Record<string, string>
}

type SnapshotMovement = {
  id?: string
  type: MovementType
  articleId?: string
  articleCode: string
  quantity: number
  movementDate: string
  registeredAt?: string
  supplier?: string
  reason?: string
  documentRef?: string
  notes?: string
  idempotencyKey?: string
  performedByUid?: string
  performedByUsername?: string
}

type ImportSnapshotPayload = {
  brandId: string
  articles: SnapshotArticle[]
  movements: SnapshotMovement[]
}

const BRANDS = new Set(['marina-raphael', 'elie-saab', 'swarovski'])

function formatStock(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function parseStock(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const text = String(raw ?? '0').trim().replace(/\s/g, '').replace(',', '.')
  const n = Number.parseFloat(text)
  return Number.isFinite(n) ? n : 0
}

function requireTrustedOperator(uid: string): Promise<{ username: string; role: string }> {
  const db = getFirestore()
  return db
    .doc(`users/${uid}`)
    .get()
    .then((userSnap) => {
      if (!userSnap.exists || userSnap.get('active') !== true) {
        throw new HttpsError('permission-denied', 'Profilo utente non attivo.')
      }
      const role = userSnap.get('role')
      if (role !== 'admin' && role !== 'operator') {
        throw new HttpsError('permission-denied', 'Ruolo non autorizzato.')
      }
      return {
        username: String(userSnap.get('username') ?? uid),
        role: String(role),
      }
    })
}

function assertBrandId(brandId: string): string {
  if (!BRANDS.has(brandId)) {
    throw new HttpsError('invalid-argument', 'Brand non valido.')
  }
  return brandId
}

function assertIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${label} non valida.`)
  }
  return value
}

/**
 * Unico ingresso server-side per CARICO/SCARICO.
 * - Auth obbligatoria + profilo users/{uid} attendibile
 * - Isolamento brand
 * - Transazione atomica movimento + currentStock
 * - Idempotenza su document id = idempotencyKey
 * - SCARICO con giacenza insufficiente → sempre rifiutato (no overdraft cloud)
 */
export const registerWarehouseMovement = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Autenticazione obbligatoria.')
  }

  const uid = request.auth.uid
  const { username } = await requireTrustedOperator(uid)

  const data = (request.data ?? {}) as RegisterPayload
  const brandId = assertBrandId(String(data.brandId ?? ''))
  const type = data.type
  if (type !== 'CARICO' && type !== 'SCARICO') {
    throw new HttpsError('invalid-argument', 'Tipo movimento non valido.')
  }

  const code = String(data.articleCode ?? '').trim()
  const articleId = code.toLowerCase()
  const idempotencyKey = String(data.idempotencyKey ?? '').trim()
  const quantity = Number(data.quantity)
  const movementDate = assertIsoDate(String(data.movementDate ?? '').trim(), 'Data movimento')
  const supplier = String(data.supplier ?? '').trim()
  const reason = String(data.reason ?? '').trim()
  const documentRef = String(data.documentRef ?? '').trim()
  const notes = String(data.notes ?? '').trim()

  if (!code || !idempotencyKey) {
    throw new HttpsError('invalid-argument', 'Codice articolo o chiave idempotenza mancanti.')
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new HttpsError('invalid-argument', 'La quantità deve essere > 0.')
  }
  if (type === 'CARICO') {
    if (!supplier) throw new HttpsError('invalid-argument', 'Fornitore obbligatorio per CARICO.')
    if (!documentRef) {
      throw new HttpsError('invalid-argument', 'Riferimento documento obbligatorio per CARICO.')
    }
  }
  if (type === 'SCARICO' && !reason) {
    throw new HttpsError('invalid-argument', 'Causale obbligatoria per SCARICO.')
  }

  const db = getFirestore()
  const articleRef = db.doc(`brands/${brandId}/articles/${articleId}`)
  const movementRef = db.doc(`brands/${brandId}/movements/${idempotencyKey}`)

  return db.runTransaction(async (tx) => {
    const existingMov = await tx.get(movementRef)
    const articleSnap = await tx.get(articleRef)

    if (!articleSnap.exists) {
      throw new HttpsError('not-found', `Articolo inesistente: ${code}`)
    }

    const previousRaw = String(articleSnap.get('currentStock') ?? articleSnap.get('stock') ?? '0')
    const previous = parseStock(previousRaw)
    const articleCode = String(articleSnap.get('code') ?? code)

    if (existingMov.exists) {
      const existing = existingMov.data() ?? {}
      return {
        alreadyApplied: true,
        movementId: idempotencyKey,
        previousStock: previousRaw,
        newStock: previousRaw,
        movement: {
          id: String(existing.id ?? idempotencyKey),
          type: existing.type === 'SCARICO' ? 'SCARICO' : 'CARICO',
          articleId: String(existing.articleId ?? articleId),
          articleCode: String(existing.articleCode ?? articleCode),
          quantity: Number(existing.quantity ?? quantity),
          movementDate: String(existing.movementDate ?? movementDate),
          registeredAt: String(existing.registeredAt ?? ''),
          supplier: String(existing.supplier ?? ''),
          reason: String(existing.reason ?? ''),
          documentRef: String(existing.documentRef ?? ''),
          notes: String(existing.notes ?? ''),
          idempotencyKey: String(existing.idempotencyKey ?? idempotencyKey),
          performedByUid: String(existing.performedByUid ?? uid),
          performedByUsername: String(existing.performedByUsername ?? username),
        },
      }
    }

    // Nessun overdraft in cloud: rifiuto sempre se SCARICO > giacenza.
    if (type === 'SCARICO' && previous + 1e-9 < quantity) {
      throw new HttpsError(
        'failed-precondition',
        `Giacenza insufficiente (${previousRaw}). Scarico rifiutato.`,
      )
    }

    const next = type === 'CARICO' ? previous + quantity : previous - quantity
    if (type === 'SCARICO' && next < -1e-9) {
      throw new HttpsError(
        'failed-precondition',
        `Operazione rifiutata: giacenza risultante negativa.`,
      )
    }

    const newStock = formatStock(next)
    const stockVersion = Number(articleSnap.get('stockVersion') ?? 0) + 1
    const registeredAt = new Date().toISOString()

    const movement = {
      id: idempotencyKey,
      type,
      articleId,
      articleCode,
      quantity,
      movementDate,
      registeredAt,
      supplier: type === 'CARICO' ? supplier : '',
      reason: type === 'SCARICO' ? reason : '',
      documentRef,
      notes,
      idempotencyKey,
      performedByUid: uid,
      performedByUsername: username,
    }

    tx.create(movementRef, movement)
    tx.update(articleRef, {
      currentStock: newStock,
      stockVersion,
      updatedAt: registeredAt,
      updatedByUid: uid,
      updatedAtServer: FieldValue.serverTimestamp(),
    })

    return {
      alreadyApplied: false,
      movementId: idempotencyKey,
      previousStock: previousRaw,
      newStock,
      movement,
    }
  })
})

/**
 * Import/migrazione admin: scrive articoli e movimenti con Admin SDK.
 * Ricalcola currentStock = stock iniziale + Σ movimenti (per articolo).
 * Idempotente: documenti già presenti vengono saltati (movimenti) / merge anagrafica (articoli).
 */
export const importBrandSnapshot = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Autenticazione obbligatoria.')
  }

  const uid = request.auth.uid
  const profile = await requireTrustedOperator(uid)
  if (profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admin può importare snapshot brand.')
  }

  const data = (request.data ?? {}) as ImportSnapshotPayload
  const brandId = assertBrandId(String(data.brandId ?? ''))
  // Isolamento: tutte le scritture usano esclusivamente questo brandId validato.
  // Nessun path o brand secondario è accettato dal payload.
  const articles = Array.isArray(data.articles) ? data.articles : []
  const movements = Array.isArray(data.movements) ? data.movements : []
  if (articles.length === 0 && movements.length === 0) {
    throw new HttpsError('invalid-argument', 'Snapshot vuoto: nessun articolo né movimento.')
  }

  const db = getFirestore()
  let writtenArticles = 0
  let skippedArticles = 0
  let writtenMovements = 0
  let skippedMovements = 0

  const movementsByArticle = new Map<string, SnapshotMovement[]>()
  for (const raw of movements) {
    const articleCode = String(raw.articleCode ?? '').trim()
    if (!articleCode) continue
    const key = String(raw.articleId ?? articleCode).trim().toLowerCase()
    const list = movementsByArticle.get(key) ?? []
    list.push(raw)
    movementsByArticle.set(key, list)
  }

  // Movimenti (create-only idempotente)
  for (const raw of movements) {
    const articleCode = String(raw.articleCode ?? '').trim()
    if (!articleCode) continue
    const mid = String(raw.idempotencyKey || raw.id || '').trim()
    if (!mid) continue
    if (raw.type !== 'CARICO' && raw.type !== 'SCARICO') continue
    const qty = Number(raw.quantity)
    if (!Number.isFinite(qty) || qty <= 0) continue

    const ref = db.doc(`brands/${brandId}/movements/${mid}`)
    const existing = await ref.get()
    if (existing.exists) {
      skippedMovements += 1
      continue
    }
    await ref.create({
      id: mid,
      type: raw.type,
      articleId: String(raw.articleId ?? articleCode).trim().toLowerCase(),
      articleCode,
      quantity: qty,
      movementDate: String(raw.movementDate ?? ''),
      registeredAt: String(raw.registeredAt ?? new Date().toISOString()),
      supplier: String(raw.supplier ?? ''),
      reason: String(raw.reason ?? ''),
      documentRef: String(raw.documentRef ?? ''),
      notes: String(raw.notes ?? ''),
      idempotencyKey: mid,
      performedByUid: String(raw.performedByUid ?? uid),
      performedByUsername: String(raw.performedByUsername ?? profile.username),
    })
    writtenMovements += 1
  }

  // Articoli + riconciliazione giacenza
  for (const raw of articles) {
    const code = String(raw.code ?? '').trim()
    if (!code) continue
    const codeKey = code.toLowerCase()
    const ref = db.doc(`brands/${brandId}/articles/${codeKey}`)
    const existing = await ref.get()
    const initialStock = String(raw.stock ?? '0')
    const articleMovements = movementsByArticle.get(codeKey) ?? []
    let totalIn = 0
    let totalOut = 0
    for (const m of articleMovements) {
      const q = Number(m.quantity)
      if (!Number.isFinite(q) || q <= 0) continue
      if (m.type === 'CARICO') totalIn += q
      else if (m.type === 'SCARICO') totalOut += q
    }
    const currentStock = formatStock(parseStock(initialStock) + totalIn - totalOut)

    if (!existing.exists) {
      await ref.set({
        code,
        codeKey,
        description: String(raw.description ?? '—'),
        unitOfMeasure: String(raw.unitOfMeasure ?? '—'),
        stock: initialStock,
        currentStock,
        status: String(raw.status ?? '—'),
        category: String(raw.category ?? '—'),
        supplier: String(raw.supplier ?? '—'),
        minStock: String(raw.minStock ?? '—'),
        totalReceived: String(raw.totalReceived ?? '—'),
        sourceFields: raw.sourceFields && typeof raw.sourceFields === 'object' ? raw.sourceFields : {},
        stockVersion: 0,
        updatedAt: new Date().toISOString(),
        updatedByUid: uid,
      })
      writtenArticles += 1
    } else {
      await ref.set(
        {
          currentStock,
          updatedAt: new Date().toISOString(),
          updatedByUid: uid,
          migrationReconciledAt: new Date().toISOString(),
        },
        { merge: true },
      )
      skippedArticles += 1
    }
  }

  return {
    brandId,
    writtenArticles,
    skippedArticles,
    writtenMovements,
    skippedMovements,
  }
})
