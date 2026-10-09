import { enrichArticleFromSourceFields } from '../excel/resolveArticleFields'
import { normalizeArticleRecord, type ArticleRecord } from '../types/articles'

const DB_NAME = 'magazzino-mr'
const DB_VERSION = 1
const ARTICLES_STORE = 'articles'

export type StoredArticle = ArticleRecord & {
  codeKey: string
  createdAt: string
  updatedAt: string
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Operazione IndexedDB non riuscita.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
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

export async function openArticlesDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    throw new Error('IndexedDB non è disponibile in questo browser.')
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ARTICLES_STORE)) {
        const store = db.createObjectStore(ARTICLES_STORE, { keyPath: 'codeKey' })
        store.createIndex('code', 'code', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Impossibile aprire il database locale.'))
  })
}

function toStoredArticle(article: ArticleRecord, existing?: StoredArticle): StoredArticle {
  const now = new Date().toISOString()
  const enriched = enrichArticleFromSourceFields(normalizeArticleRecord(article))
  return {
    ...enriched,
    codeKey: enriched.code.trim().toLowerCase(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export function toArticleRecord(stored: StoredArticle): ArticleRecord {
  return enrichArticleFromSourceFields(normalizeArticleRecord(stored))
}

function articleNeedsEnrichment(stored: StoredArticle): boolean {
  const before = normalizeArticleRecord(stored)
  const after = enrichArticleFromSourceFields(before)
  return (
    before.stock !== after.stock ||
    before.category !== after.category ||
    before.minStock !== after.minStock ||
    before.supplier !== after.supplier ||
    before.totalReceived !== after.totalReceived ||
    before.unitOfMeasure !== after.unitOfMeasure ||
    before.status !== after.status ||
    JSON.stringify(before.sourceFields) !== JSON.stringify(after.sourceFields)
  )
}

/**
 * Migrazione compatibile: arricchisce i record esistenti da sourceFields
 * senza cancellare articoli già importati.
 */
async function migrateEnrichArticlesFromSourceFields(db: IDBDatabase): Promise<void> {
  const readTx = db.transaction(ARTICLES_STORE, 'readonly')
  const readStore = readTx.objectStore(ARTICLES_STORE)
  const existing = await requestToPromise(readStore.getAll() as IDBRequest<StoredArticle[]>)
  await transactionDone(readTx)

  const toUpdate = existing.filter(articleNeedsEnrichment)
  if (toUpdate.length === 0) {
    return
  }

  const writeTx = db.transaction(ARTICLES_STORE, 'readwrite')
  const writeStore = writeTx.objectStore(ARTICLES_STORE)

  for (const stored of toUpdate) {
    const enriched = toStoredArticle(toArticleRecord(stored), stored)
    writeStore.put(enriched)
  }

  await transactionDone(writeTx)
}

export async function loadAllArticles(): Promise<ArticleRecord[]> {
  const db = await openArticlesDatabase()

  try {
    await migrateEnrichArticlesFromSourceFields(db)

    const transaction = db.transaction(ARTICLES_STORE, 'readonly')
    const store = transaction.objectStore(ARTICLES_STORE)
    const result = await requestToPromise(store.getAll() as IDBRequest<StoredArticle[]>)
    await transactionDone(transaction)

    return result
      .map(toArticleRecord)
      .sort((a, b) => a.code.localeCompare(b.code, 'it', { sensitivity: 'base' }))
  } finally {
    db.close()
  }
}

export type PersistArticlesResult = {
  added: ArticleRecord[]
  skippedExisting: ArticleRecord[]
  enrichedExisting: ArticleRecord[]
  totalAfter: number
}

function isBlankField(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return trimmed.length === 0 || trimmed === '—'
}

function preferExisting(current: string, incoming: string): string {
  if (!isBlankField(current)) {
    return current.trim()
  }
  if (!isBlankField(incoming)) {
    return incoming.trim()
  }
  return '—'
}

/**
 * Unisce un articolo già presente con i dati in arrivo:
 * - non cancella il record
 * - non sovrascrive campi già valorizzati
 * - arricchisce campi vuoti e unisce sourceFields
 */
function mergeIncomingIntoExisting(
  existingStored: StoredArticle,
  incoming: ArticleRecord,
): StoredArticle {
  const existing = toArticleRecord(existingStored)
  const next = normalizeArticleRecord(incoming)

  const merged = normalizeArticleRecord({
    code: existing.code,
    description: preferExisting(existing.description, next.description),
    unitOfMeasure: preferExisting(existing.unitOfMeasure, next.unitOfMeasure),
    stock: preferExisting(existing.stock, next.stock),
    status: preferExisting(existing.status, next.status),
    category: preferExisting(existing.category, next.category),
    supplier: preferExisting(existing.supplier, next.supplier),
    minStock: preferExisting(existing.minStock, next.minStock),
    totalReceived: preferExisting(existing.totalReceived, next.totalReceived),
    sourceFields: {
      ...existing.sourceFields,
      ...next.sourceFields,
    },
  })

  return toStoredArticle(merged, existingStored)
}

function storedChanged(before: StoredArticle, after: StoredArticle): boolean {
  const left = toArticleRecord(before)
  const right = toArticleRecord(after)
  return JSON.stringify(left) !== JSON.stringify(right)
}

/**
 * Inserisce articoli nuovi e arricchisce quelli esistenti senza sovrascrivere
 * i campi già valorizzati. Nessun movimento di magazzino viene creato.
 * Considera riuscito solo se la transazione IndexedDB completa correttamente.
 */
export async function persistNewArticles(articles: ArticleRecord[]): Promise<PersistArticlesResult> {
  const db = await openArticlesDatabase()

  try {
    const readTx = db.transaction(ARTICLES_STORE, 'readonly')
    const readStore = readTx.objectStore(ARTICLES_STORE)
    const existing = await requestToPromise(readStore.getAll() as IDBRequest<StoredArticle[]>)
    await transactionDone(readTx)

    const existingByKey = new Map(existing.map((item) => [item.codeKey, item]))
    const added: ArticleRecord[] = []
    const skippedExisting: ArticleRecord[] = []
    const enrichedExisting: ArticleRecord[] = []
    const toInsert: StoredArticle[] = []
    const toUpdate: StoredArticle[] = []

    for (const article of articles) {
      const code = article.code.trim()
      if (!code) {
        continue
      }

      const codeKey = code.toLowerCase()
      const current = existingByKey.get(codeKey)

      if (current) {
        const merged = mergeIncomingIntoExisting(current, { ...article, code })
        if (storedChanged(current, merged)) {
          toUpdate.push(merged)
          enrichedExisting.push(toArticleRecord(merged))
          existingByKey.set(codeKey, merged)
        } else {
          skippedExisting.push(toArticleRecord(current))
        }
        continue
      }

      const stored = toStoredArticle({ ...article, code })
      toInsert.push(stored)
      existingByKey.set(codeKey, stored)
      added.push(toArticleRecord(stored))
    }

    if (toInsert.length > 0 || toUpdate.length > 0) {
      const writeTx = db.transaction(ARTICLES_STORE, 'readwrite')
      const writeStore = writeTx.objectStore(ARTICLES_STORE)

      for (const article of toInsert) {
        writeStore.add(article)
      }
      for (const article of toUpdate) {
        writeStore.put(article)
      }

      await transactionDone(writeTx)
    }

    return {
      added,
      skippedExisting,
      enrichedExisting,
      totalAfter: existingByKey.size,
    }
  } finally {
    db.close()
  }
}

/**
 * Aggiorna i campi strutturati mancanti da sourceFields per articoli già presenti,
 * senza sostituire valori già valorizzati e senza cancellare record.
 */
export async function enrichExistingArticlesInPlace(): Promise<number> {
  const db = await openArticlesDatabase()
  try {
    await migrateEnrichArticlesFromSourceFields(db)
    const transaction = db.transaction(ARTICLES_STORE, 'readonly')
    const store = transaction.objectStore(ARTICLES_STORE)
    const result = await requestToPromise(store.getAll() as IDBRequest<StoredArticle[]>)
    await transactionDone(transaction)
    return result.length
  } finally {
    db.close()
  }
}

export async function replaceAllArticles(articles: ArticleRecord[]): Promise<number> {
  const db = await openArticlesDatabase()

  try {
    const transaction = db.transaction(ARTICLES_STORE, 'readwrite')
    const store = transaction.objectStore(ARTICLES_STORE)
    store.clear()

    const seen = new Set<string>()
    let count = 0

    for (const article of articles) {
      const code = article.code.trim()
      if (!code) {
        continue
      }
      const codeKey = code.toLowerCase()
      if (seen.has(codeKey)) {
        continue
      }
      seen.add(codeKey)
      store.put(toStoredArticle({ ...article, code }))
      count += 1
    }

    await transactionDone(transaction)
    return count
  } finally {
    db.close()
  }
}
