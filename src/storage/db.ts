import { getActiveBrandId } from '../brands/brandPreference'
import { getBrandDefinition, type BrandId } from '../brands/brands'

/** Nome storico del DB Marina Raphael (non rinominare). */
export const LEGACY_MR_DB_NAME = 'magazzino-mr'
/** @deprecated Preferire getBrandDefinition(brandId).dbName */
export const DB_NAME = LEGACY_MR_DB_NAME
/** v2: store movimenti + currentStock sugli articoli. Schema identico per ogni brand. */
export const DB_VERSION = 2
export const ARTICLES_STORE = 'articles'
export const MOVEMENTS_STORE = 'movements'

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Operazione IndexedDB non riuscita.'))
  })
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transazione IndexedDB non riuscita.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transazione IndexedDB annullata.'))
  })
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function applySchemaUpgrade(db: IDBDatabase, oldVersion: number, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains(ARTICLES_STORE)) {
    const store = db.createObjectStore(ARTICLES_STORE, { keyPath: 'codeKey' })
    store.createIndex('code', 'code', { unique: false })
  }

  if (!db.objectStoreNames.contains(MOVEMENTS_STORE)) {
    const movements = db.createObjectStore(MOVEMENTS_STORE, { keyPath: 'id' })
    movements.createIndex('articleId', 'articleId', { unique: false })
    movements.createIndex('type', 'type', { unique: false })
    movements.createIndex('idempotencyKey', 'idempotencyKey', { unique: true })
    movements.createIndex('movementDate', 'movementDate', { unique: false })
  }

  // Migrazione dati articoli: currentStock da stock storico (solo se assente).
  // Per DB nuovi (ELIE SAAB / Swarovski) oldVersion è 0 e non ci sono record da migrare.
  if (oldVersion < 2 && db.objectStoreNames.contains(ARTICLES_STORE) && tx) {
    const articlesStore = tx.objectStore(ARTICLES_STORE)
    const cursorRequest = articlesStore.openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        return
      }
      const value = cursor.value as Record<string, unknown>
      const stock = typeof value.stock === 'string' ? value.stock : '—'
      const current =
        typeof value.currentStock === 'string' && value.currentStock.trim()
          ? value.currentStock
          : stock === '—' || stock.trim() === ''
            ? '0'
            : stock
      cursor.update({
        ...value,
        currentStock: current,
      })
      cursor.continue()
    }
  }
}

/**
 * Apre il database IndexedDB del brand indicato.
 * Default: brand attivo in localStorage (di norma Marina Raphael / magazzino-mr).
 */
export async function openMagazzinoDatabase(brandId?: BrandId): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    throw new Error('IndexedDB non è disponibile in questo browser.')
  }

  const resolvedBrandId = brandId ?? getActiveBrandId()
  const dbName = getBrandDefinition(resolvedBrandId).dbName

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION)

    request.onupgradeneeded = (event) => {
      applySchemaUpgrade(request.result, event.oldVersion, request.transaction)
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error(`Impossibile aprire il database locale (${dbName}).`))
  })
}
