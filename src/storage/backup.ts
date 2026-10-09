import { normalizeArticleRecord, type ArticleRecord } from '../types/articles'
import { loadAllArticles, replaceAllArticles } from './articlesDb'

export const BACKUP_FORMAT = 'magazzino-mr-backup' as const
export const BACKUP_VERSION = 1 as const

export type MagazzinoBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  meta: {
    articleCount: number
    source: 'indexeddb-local'
  }
  articles: ArticleRecord[]
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

export function validateBackupPayload(payload: unknown): MagazzinoBackup {
  if (!isRecord(payload)) {
    throw new Error('Il file di backup non contiene un oggetto JSON valido.')
  }

  if (payload.format !== BACKUP_FORMAT) {
    throw new Error('Formato backup non riconosciuto. Atteso: magazzino-mr-backup.')
  }

  if (payload.version !== BACKUP_VERSION) {
    throw new Error(
      `Versione backup non supportata (${String(payload.version)}). Supportata: ${BACKUP_VERSION}.`,
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

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: payload.exportedAt,
    meta: {
      articleCount: articles.length,
      source: 'indexeddb-local',
    },
    articles,
  }
}

export async function createArticlesBackup(): Promise<MagazzinoBackup> {
  const articles = await loadAllArticles()

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      articleCount: articles.length,
      source: 'indexeddb-local',
    },
    articles,
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

export async function restoreArticlesBackup(payload: unknown): Promise<number> {
  const backup = validateBackupPayload(payload)
  return replaceAllArticles(backup.articles)
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
