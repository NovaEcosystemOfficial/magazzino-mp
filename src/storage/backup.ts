import { normalizeArticleRecord, type ArticleRecord } from '../types/articles'
import { normalizeStockMovement, type StockMovement } from '../types/movements'
import { loadAllArticles, replaceAllArticles } from './articlesDb'
import { loadAllMovements, replaceAllMovements } from './movementsDb'

export const BACKUP_FORMAT = 'magazzino-mr-backup' as const
/** v1: solo articoli. v2: articoli + movimenti (carichi/scarichi). */
export const BACKUP_VERSION = 2 as const
export const BACKUP_VERSION_LEGACY = 1 as const

export type MagazzinoBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION | typeof BACKUP_VERSION_LEGACY
  exportedAt: string
  meta: {
    articleCount: number
    movementCount: number
    source: 'indexeddb-local'
  }
  articles: ArticleRecord[]
  movements: StockMovement[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArticleRecord(value: unknown): value is ArticleRecord {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.code === 'string' &&
    typeof value.description === 'string' &&
    typeof value.unitOfMeasure === 'string' &&
    typeof value.stock === 'string' &&
    typeof value.status === 'string'
  )
}

function isMovementRecord(value: unknown): value is StockMovement {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    (value.type === 'CARICO' || value.type === 'SCARICO') &&
    typeof value.articleId === 'string' &&
    typeof value.articleCode === 'string' &&
    typeof value.quantity === 'number' &&
    Number.isFinite(value.quantity) &&
    typeof value.movementDate === 'string' &&
    typeof value.registeredAt === 'string' &&
    typeof value.documentRef === 'string' &&
    typeof value.notes === 'string' &&
    typeof value.idempotencyKey === 'string'
  )
}

export function validateBackupPayload(payload: unknown): MagazzinoBackup {
  if (!isRecord(payload)) {
    throw new Error('Il file di backup non contiene un oggetto JSON valido.')
  }

  if (payload.format !== BACKUP_FORMAT) {
    throw new Error('Formato backup non riconosciuto. Atteso: magazzino-mr-backup.')
  }

  const version = payload.version
  if (version !== BACKUP_VERSION && version !== BACKUP_VERSION_LEGACY) {
    throw new Error(
      `Versione backup non supportata (${String(version)}). Supportate: ${BACKUP_VERSION_LEGACY}, ${BACKUP_VERSION}.`,
    )
  }

  if (typeof payload.exportedAt !== 'string' || !payload.exportedAt.trim()) {
    throw new Error('Metadato exportedAt mancante o non valido.')
  }

  if (!isRecord(payload.meta) || typeof payload.meta.articleCount !== 'number') {
    throw new Error('Metadati del backup incompleti o non validi.')
  }

  if (!Array.isArray(payload.articles)) {
    throw new Error('Il backup non contiene un elenco articoli valido.')
  }

  const articles: ArticleRecord[] = []
  for (const [index, item] of payload.articles.entries()) {
    if (!isArticleRecord(item)) {
      throw new Error(`Articolo non valido alla posizione ${index + 1} del backup.`)
    }
    if (!item.code.trim()) {
      throw new Error(`Articolo alla posizione ${index + 1} senza codice.`)
    }
    articles.push(
      normalizeArticleRecord({
        code: item.code.trim(),
        description: item.description,
        unitOfMeasure: item.unitOfMeasure,
        stock: item.stock,
        currentStock: typeof item.currentStock === 'string' ? item.currentStock : undefined,
        status: item.status,
        category: typeof item.category === 'string' ? item.category : undefined,
        supplier: typeof item.supplier === 'string' ? item.supplier : undefined,
        minStock: typeof item.minStock === 'string' ? item.minStock : undefined,
        totalReceived: typeof item.totalReceived === 'string' ? item.totalReceived : undefined,
        sourceFields:
          isRecord(item.sourceFields) &&
          Object.values(item.sourceFields).every((value) => typeof value === 'string')
            ? (item.sourceFields as Record<string, string>)
            : undefined,
      }),
    )
  }

  if (payload.meta.articleCount !== articles.length) {
    throw new Error(
      `Il conteggio metadati (${payload.meta.articleCount}) non corrisponde agli articoli (${articles.length}).`,
    )
  }

  let movements: StockMovement[] = []
  if (version === BACKUP_VERSION_LEGACY) {
    // Compatibilità: backup v1 senza movimenti.
    movements = []
  } else if (!Array.isArray(payload.movements)) {
    throw new Error('Il backup v2 non contiene un elenco movimenti valido.')
  } else {
    for (const [index, item] of payload.movements.entries()) {
      if (!isMovementRecord(item)) {
        throw new Error(`Movimento non valido alla posizione ${index + 1} del backup.`)
      }
      movements.push(
        normalizeStockMovement({
          ...item,
          supplier: typeof item.supplier === 'string' ? item.supplier : '',
          reason: typeof item.reason === 'string' ? item.reason : '',
        }),
      )
    }
    if (
      typeof payload.meta.movementCount === 'number' &&
      payload.meta.movementCount !== movements.length
    ) {
      throw new Error(
        `Il conteggio movimenti metadati (${payload.meta.movementCount}) non corrisponde ai movimenti (${movements.length}).`,
      )
    }
  }

  return {
    format: BACKUP_FORMAT,
    version,
    exportedAt: payload.exportedAt,
    meta: {
      articleCount: articles.length,
      movementCount: movements.length,
      source: 'indexeddb-local',
    },
    articles,
    movements,
  }
}

export async function createArticlesBackup(): Promise<MagazzinoBackup> {
  const [articles, movements] = await Promise.all([loadAllArticles(), loadAllMovements()])

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      articleCount: articles.length,
      movementCount: movements.length,
      source: 'indexeddb-local',
    },
    articles,
    movements,
  }
}

export function downloadBackupJson(backup: MagazzinoBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const stamp = backup.exportedAt.slice(0, 19).replace(/[:T]/g, '-')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `magazzino-mr-backup-v${backup.version}-${stamp}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type RestoreBackupResult = {
  articleCount: number
  movementCount: number
}

export async function restoreArticlesBackup(payload: unknown): Promise<RestoreBackupResult> {
  const backup = validateBackupPayload(payload)
  const articleCount = await replaceAllArticles(backup.articles)
  const movementCount = await replaceAllMovements(backup.movements)
  return { articleCount, movementCount }
}

export async function parseBackupFile(file: File): Promise<MagazzinoBackup> {
  let text: string
  try {
    text = await file.text()
  } catch {
    throw new Error('Impossibile leggere il file di backup.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('Il file selezionato non è un JSON valido.')
  }

  return validateBackupPayload(parsed)
}
