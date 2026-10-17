/**
 * Migrazione IndexedDB → Firestore.
 * Percorso Spark: scritture client (admin) con rules che consentono create movimenti
 * e riconciliazione giacenza admin.
 * Percorso opzionale Blaze: importBrandSnapshot se VITE_USE_STOCK_CALLABLE=true.
 * Non cancella IndexedDB. Non attiva il cloud automaticamente.
 */

import { doc, getDoc, setDoc, type Firestore, writeBatch } from 'firebase/firestore'
import { BRAND_DEFINITIONS, type BrandId } from '../brands/brands'
import { getFirebaseFirestore } from '../firebase/firestore'
import type { MovementActor } from '../types/actor'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { computeCurrentStock } from '../utils/stockBalance'
import { loadAllArticles } from '../storage/articlesDb'
import { loadAllMovements } from '../storage/movementsDb'
import {
  CLOUD_ARTICLES_COLLECTION,
  CLOUD_BRANDS_COLLECTION,
  CLOUD_MOVEMENTS_COLLECTION,
} from './paths'
import { listCloudArticles, listCloudMovements } from './warehouseRead'
import {
  importBrandSnapshotViaCallable,
  isStockCallableRequested,
} from './registerMovementCallable'

export type BrandMigrationReport = {
  brandId: BrandId
  localArticles: number
  localMovements: number
  writtenArticles: number
  writtenMovements: number
  skippedArticles: number
  skippedMovements: number
  cloudArticlesAfter: number
  cloudMovementsAfter: number
  stockMismatches: string[]
}

export type MigrationReport = {
  exportedAt: string
  brands: BrandMigrationReport[]
  ok: boolean
}

const BATCH_LIMIT = 400

async function commitBatches(
  db: Firestore,
  ops: Array<{ path: string[]; data: Record<string, unknown> }>,
): Promise<number> {
  let written = 0
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const chunk = ops.slice(i, i + BATCH_LIMIT)
    const batch = writeBatch(db)
    for (const op of chunk) {
      const ref = doc(db, ...(op.path as [string, ...string[]]))
      batch.set(ref, op.data, { merge: true })
    }
    await batch.commit()
    written += chunk.length
  }
  return written
}

function articlePayload(
  article: ArticleRecord,
  codeKey: string,
  movements: StockMovement[],
  actor: MovementActor,
): Record<string, unknown> {
  const currentStock = computeCurrentStock(article.stock, movements)
  return {
    code: article.code,
    codeKey,
    description: article.description,
    unitOfMeasure: article.unitOfMeasure,
    stock: article.stock,
    currentStock,
    status: article.status,
    category: article.category,
    supplier: article.supplier,
    minStock: article.minStock,
    totalReceived: article.totalReceived,
    sourceFields: article.sourceFields ?? {},
    stockVersion: 0,
    updatedAt: new Date().toISOString(),
    updatedByUid: actor.uid,
  }
}

function movementPayload(movement: StockMovement, actor: MovementActor): Record<string, unknown> {
  const id = movement.idempotencyKey || movement.id
  return {
    id,
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
    idempotencyKey: id,
    performedByUid: movement.performedByUid || actor.uid,
    performedByUsername: movement.performedByUsername || actor.username,
  }
}

async function migrateBrandSparkClient(
  brandId: BrandId,
  actor: MovementActor,
  db: Firestore,
): Promise<BrandMigrationReport> {
  const localArticles = await loadAllArticles(brandId)
  const localMovements = await loadAllMovements(brandId)
  const movementsByArticle = new Map<string, StockMovement[]>()
  for (const m of localMovements) {
    const key = m.articleId || m.articleCode.toLowerCase()
    const list = movementsByArticle.get(key) ?? []
    list.push(m)
    movementsByArticle.set(key, list)
  }

  const touchedArticleKeys = new Set<string>()
  const articleOps: Array<{ path: string[]; data: Record<string, unknown> }> = []
  let skippedArticles = 0
  for (const article of localArticles) {
    const codeKey = article.code.trim().toLowerCase()
    if (!codeKey) continue
    const ref = doc(db, CLOUD_BRANDS_COLLECTION, brandId, CLOUD_ARTICLES_COLLECTION, codeKey)
    const existing = await getDoc(ref)
    if (existing.exists()) {
      skippedArticles += 1
      continue
    }
    touchedArticleKeys.add(codeKey)
    articleOps.push({
      path: [CLOUD_BRANDS_COLLECTION, brandId, CLOUD_ARTICLES_COLLECTION, codeKey],
      data: articlePayload(article, codeKey, movementsByArticle.get(codeKey) ?? [], actor),
    })
  }
  const writtenArticles = await commitBatches(db, articleOps)

  const movementOps: Array<{ path: string[]; data: Record<string, unknown> }> = []
  let skippedMovements = 0
  for (const movement of localMovements) {
    const mid = (movement.idempotencyKey || movement.id).trim()
    if (!mid) continue
    const ref = doc(db, CLOUD_BRANDS_COLLECTION, brandId, CLOUD_MOVEMENTS_COLLECTION, mid)
    const existing = await getDoc(ref)
    if (existing.exists()) {
      skippedMovements += 1
      continue
    }
    const articleKey = (movement.articleId || movement.articleCode).trim().toLowerCase()
    if (articleKey) touchedArticleKeys.add(articleKey)
    movementOps.push({
      path: [CLOUD_BRANDS_COLLECTION, brandId, CLOUD_MOVEMENTS_COLLECTION, mid],
      data: movementPayload(movement, actor),
    })
  }
  const writtenMovements = await commitBatches(db, movementOps)

  // Riconciliazione verificata: solo articoli toccati da questa migrazione, e solo se
  // currentStock ≠ stock cloud + Σ movimenti cloud (niente overwrite cieco da IndexedDB).
  if (touchedArticleKeys.size > 0) {
    const cloudArticles = await listCloudArticles(brandId, { db })
    const cloudMovements = await listCloudMovements(brandId, { db })
    const reconcileOps: Array<{ path: string[]; data: Record<string, unknown> }> = []
    for (const cloud of cloudArticles) {
      const codeKey = (cloud.codeKey || cloud.code).trim().toLowerCase()
      if (!codeKey || !touchedArticleKeys.has(codeKey)) continue
      const related = cloudMovements.filter(
        (m) =>
          m.articleId === codeKey || m.articleCode.trim().toLowerCase() === codeKey,
      )
      const expected = computeCurrentStock(cloud.stock, related)
      if (cloud.currentStock === expected) continue
      reconcileOps.push({
        path: [CLOUD_BRANDS_COLLECTION, brandId, CLOUD_ARTICLES_COLLECTION, codeKey],
        data: {
          currentStock: expected,
          updatedAt: new Date().toISOString(),
          updatedByUid: actor.uid,
          migrationReconciledAt: new Date().toISOString(),
        },
      })
    }
    await commitBatches(db, reconcileOps)
  }

  return buildReport(brandId, localArticles, localMovements, {
    writtenArticles,
    writtenMovements,
    skippedArticles,
    skippedMovements,
  })
}

async function buildReport(
  brandId: BrandId,
  localArticles: ArticleRecord[],
  localMovements: StockMovement[],
  counts: {
    writtenArticles: number
    writtenMovements: number
    skippedArticles: number
    skippedMovements: number
  },
): Promise<BrandMigrationReport> {
  const cloudArticles = await listCloudArticles(brandId)
  const cloudMovements = await listCloudMovements(brandId)
  const stockMismatches: string[] = []

  for (const local of localArticles) {
    const key = local.code.trim().toLowerCase()
    const cloud = cloudArticles.find((a) => a.codeKey === key || a.code.toLowerCase() === key)
    if (!cloud) {
      stockMismatches.push(`${local.code}: assente su cloud`)
      continue
    }
    const expected = computeCurrentStock(
      local.stock,
      localMovements.filter(
        (m) => m.articleId === key || m.articleCode.toLowerCase() === key,
      ),
    )
    if (cloud.currentStock !== expected) {
      stockMismatches.push(
        `${local.code}: giacenza cloud=${cloud.currentStock} attesa=${expected}`,
      )
    }
  }

  if (cloudMovements.length < localMovements.length) {
    stockMismatches.push(
      `movimenti cloud (${cloudMovements.length}) < locali (${localMovements.length})`,
    )
  }

  return {
    brandId,
    localArticles: localArticles.length,
    localMovements: localMovements.length,
    writtenArticles: counts.writtenArticles,
    writtenMovements: counts.writtenMovements,
    skippedArticles: counts.skippedArticles,
    skippedMovements: counts.skippedMovements,
    cloudArticlesAfter: cloudArticles.length,
    cloudMovementsAfter: cloudMovements.length,
    stockMismatches,
  }
}

export async function migrateBrandToFirestore(
  brandId: BrandId,
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<BrandMigrationReport> {
  if (!actor.uid) {
    throw new Error('Migrazione richiede un utente autenticato (admin).')
  }

  if (isStockCallableRequested()) {
    const localArticles = await loadAllArticles(brandId)
    const localMovements = await loadAllMovements(brandId)
    const result = await importBrandSnapshotViaCallable(
      brandId,
      localArticles,
      localMovements,
    )
    return buildReport(brandId, localArticles, localMovements, {
      writtenArticles: result.writtenArticles,
      writtenMovements: result.writtenMovements,
      skippedArticles: result.skippedArticles,
      skippedMovements: result.skippedMovements,
    })
  }

  return migrateBrandSparkClient(brandId, actor, db)
}

export async function migrateAllBrandsToFirestore(
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<MigrationReport> {
  const brands: BrandMigrationReport[] = []
  for (const brand of BRAND_DEFINITIONS) {
    brands.push(await migrateBrandToFirestore(brand.id, actor, db))
  }
  const ok = brands.every(
    (b) =>
      b.cloudArticlesAfter >= b.localArticles &&
      b.cloudMovementsAfter >= b.localMovements &&
      b.stockMismatches.length === 0,
  )
  return {
    exportedAt: new Date().toISOString(),
    brands,
    ok,
  }
}

export async function writeMigrationMeta(
  report: MigrationReport,
  actor: MovementActor,
  db: Firestore = getFirebaseFirestore(),
): Promise<void> {
  for (const brand of BRAND_DEFINITIONS) {
    await setDoc(
      doc(db, CLOUD_BRANDS_COLLECTION, brand.id, 'meta', 'migration'),
      {
        lastMigrationAt: report.exportedAt,
        performedByUid: actor.uid,
        report: report.brands.find((b) => b.brandId === brand.id) ?? null,
      },
      { merge: true },
    )
  }
}
