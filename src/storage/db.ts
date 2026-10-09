export const DB_NAME = 'magazzino-mr'
/** v2: store movimenti + currentStock sugli articoli. */
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

export async function openMagazzinoDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    throw new Error('IndexedDB non è disponibile in questo browser.')
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion

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
      if (oldVersion < 2 && db.objectStoreNames.contains(ARTICLES_STORE)) {
        const tx = request.transaction
        if (tx) {
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
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Impossibile aprire il database locale.'))
  })
}
