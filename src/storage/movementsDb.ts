import type { CaricoInput, StockMovement } from '../types/movements'
import { addQuantities } from '../utils/quantity'
import type { StoredArticle } from './articlesDb'
import { toArticleRecord } from './articlesDb'
import {
  ARTICLES_STORE,
  MOVEMENTS_STORE,
  openMagazzinoDatabase,
  requestToPromise,
  transactionDone,
} from './db'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mov-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function loadAllMovements(): Promise<StockMovement[]> {
  const db = await openMagazzinoDatabase()
  try {
    const tx = db.transaction(MOVEMENTS_STORE, 'readonly')
    const store = tx.objectStore(MOVEMENTS_STORE)
    const rows = await requestToPromise(store.getAll() as IDBRequest<StockMovement[]>)
    await transactionDone(tx)
    return rows.sort((a, b) => {
      const byDate = b.movementDate.localeCompare(a.movementDate)
      if (byDate !== 0) {
        return byDate
      }
      return b.registeredAt.localeCompare(a.registeredAt)
    })
  } finally {
    db.close()
  }
}

export async function loadMovementsForArticle(articleCode: string): Promise<StockMovement[]> {
  const articleId = articleCode.trim().toLowerCase()
  if (!articleId) {
    return []
  }

  const db = await openMagazzinoDatabase()
  try {
    const tx = db.transaction(MOVEMENTS_STORE, 'readonly')
    const store = tx.objectStore(MOVEMENTS_STORE)
    const index = store.index('articleId')
    const rows = await requestToPromise(index.getAll(articleId) as IDBRequest<StockMovement[]>)
    await transactionDone(tx)
    return rows.sort((a, b) => {
      const byDate = b.movementDate.localeCompare(a.movementDate)
      if (byDate !== 0) {
        return byDate
      }
      return b.registeredAt.localeCompare(a.registeredAt)
    })
  } finally {
    db.close()
  }
}

export type RegisterCaricoResult = {
  movement: StockMovement
  previousStock: string
  newStock: string
  alreadyApplied: boolean
}

/**
 * Registra un CARICO e aggiorna currentStock in un'unica transazione IndexedDB.
 * stock (giacenza Excel) non viene modificato.
 * Idempotenza: stessa idempotencyKey non crea un secondo movimento.
 */
export async function registerCarico(input: CaricoInput): Promise<RegisterCaricoResult> {
  const code = input.articleCode.trim()
  if (!code) {
    throw new Error('Articolo non valido: codice mancante.')
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('La quantità deve essere numerica, finita e maggiore di zero.')
  }

  const supplier = input.supplier.trim()
  const documentRef = input.documentRef.trim()
  const notes = input.notes.trim()
  const movementDate = input.movementDate.trim()
  const idempotencyKey = input.idempotencyKey.trim()

  if (!supplier) {
    throw new Error('Il fornitore è obbligatorio.')
  }
  if (!documentRef) {
    throw new Error('Il riferimento documento è obbligatorio.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) {
    throw new Error('La data del movimento non è valida.')
  }
  if (!idempotencyKey) {
    throw new Error('Chiave di idempotenza mancante.')
  }

  const articleId = code.toLowerCase()
  const db = await openMagazzinoDatabase()

  try {
    const tx = db.transaction([ARTICLES_STORE, MOVEMENTS_STORE], 'readwrite')
    const articlesStore = tx.objectStore(ARTICLES_STORE)
    const movementsStore = tx.objectStore(MOVEMENTS_STORE)
    const idempotencyIndex = movementsStore.index('idempotencyKey')

    const existingByKey = await requestToPromise(
      idempotencyIndex.get(idempotencyKey) as IDBRequest<StockMovement | undefined>,
    )
    if (existingByKey) {
      const article = await requestToPromise(
        articlesStore.get(articleId) as IDBRequest<StoredArticle | undefined>,
      )
      await transactionDone(tx)
      return {
        movement: existingByKey,
        previousStock: article?.currentStock ?? '—',
        newStock: article?.currentStock ?? '—',
        alreadyApplied: true,
      }
    }

    const storedArticle = await requestToPromise(
      articlesStore.get(articleId) as IDBRequest<StoredArticle | undefined>,
    )
    if (!storedArticle) {
      throw new Error(`Articolo inesistente: ${code}. Impossibile registrare il carico.`)
    }

    const article = toArticleRecord(storedArticle)
    const previousStock = article.currentStock
    const newStock = addQuantities(previousStock, input.quantity)

    const movement: StockMovement = {
      id: createId(),
      type: 'CARICO',
      articleId,
      articleCode: article.code,
      quantity: input.quantity,
      movementDate,
      registeredAt: new Date().toISOString(),
      supplier,
      documentRef,
      notes,
      idempotencyKey,
    }

    movementsStore.add(movement)

    const updatedArticle: StoredArticle = {
      ...storedArticle,
      ...article,
      // Giacenza Excel storica intatta.
      stock: storedArticle.stock,
      currentStock: newStock,
      codeKey: articleId,
      updatedAt: new Date().toISOString(),
      createdAt: storedArticle.createdAt,
    }
    articlesStore.put(updatedArticle)

    await transactionDone(tx)

    return {
      movement,
      previousStock,
      newStock,
      alreadyApplied: false,
    }
  } finally {
    db.close()
  }
}

export async function countCarichiInPeriod(fromDate: string, toDate: string): Promise<number> {
  const movements = await loadAllMovements()
  return movements.filter(
    (movement) =>
      movement.type === 'CARICO' &&
      movement.movementDate >= fromDate &&
      movement.movementDate <= toDate,
  ).length
}
