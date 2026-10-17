import { collection, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore'
import type { BrandId } from '../brands/brands'
import { getFirebaseFirestore } from '../firebase/firestore'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { normalizeStockMovement } from '../types/movements'
import { parseCloudArticleDocument, parseCloudMovementDocument } from './parseCloudDocuments'
import {
  CLOUD_ARTICLES_COLLECTION,
  CLOUD_BRANDS_COLLECTION,
  CLOUD_MOVEMENTS_COLLECTION,
  assertCloudBrandId,
} from './paths'

export type WarehouseSnapshotHandlers = {
  onArticles: (articles: ArticleRecord[]) => void
  onMovements: (movements: StockMovement[]) => void
  onError?: (error: Error) => void
}

/**
 * Sottoscrizione realtime per-brand (altri PC autorizzati vedono gli aggiornamenti).
 * Solo lettura; non scrive.
 */
export function subscribeCloudWarehouse(
  brandId: BrandId,
  handlers: WarehouseSnapshotHandlers,
  db: Firestore = getFirebaseFirestore(),
): Unsubscribe {
  const id = assertCloudBrandId(brandId)
  const articlesUnsub = onSnapshot(
    collection(db, CLOUD_BRANDS_COLLECTION, id, CLOUD_ARTICLES_COLLECTION),
    (snap) => {
      const articles = snap.docs
        .map((row) => parseCloudArticleDocument(row.id, row.data() as Record<string, unknown>))
        .sort((a, b) => a.code.localeCompare(b.code, 'it', { sensitivity: 'base' }))
      handlers.onArticles(articles)
    },
    (error) => {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
    },
  )

  const movementsUnsub = onSnapshot(
    collection(db, CLOUD_BRANDS_COLLECTION, id, CLOUD_MOVEMENTS_COLLECTION),
    (snap) => {
      const movements = snap.docs
        .map((row) =>
          normalizeStockMovement(
            parseCloudMovementDocument(row.id, row.data() as Record<string, unknown>),
          ),
        )
        .sort((a, b) => {
          const byDate = b.movementDate.localeCompare(a.movementDate)
          if (byDate !== 0) return byDate
          return b.registeredAt.localeCompare(a.registeredAt)
        })
      handlers.onMovements(movements)
    },
    (error) => {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
    },
  )

  return () => {
    articlesUnsub()
    movementsUnsub()
  }
}
