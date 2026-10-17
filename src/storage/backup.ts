import {
  BRAND_DEFINITIONS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  isBrandId,
  type BrandId,
} from '../brands/brands'
import { normalizeArticleRecord, type ArticleRecord } from '../types/articles'
import { normalizeStockMovement, type StockMovement } from '../types/movements'
import { reconcileArticlesWithMovements } from '../utils/stockBalance'
import {
  loadAllArticles as loadLocalArticles,
  replaceAllArticles,
} from './articlesDb'
import {
  loadAllMovements as loadLocalMovements,
  replaceAllMovements,
} from './movementsDb'
import { loadAllArticles, loadAllMovements } from './warehouseRepository'

export const BACKUP_FORMAT = 'magazzino-mr-backup' as const
/** v1: solo articoli (MR). v2: articoli + movimenti (MR). v3: archivi per tutti i brand. */
export const BACKUP_VERSION = 3 as const
export const BACKUP_VERSION_V2 = 2 as const
export const BACKUP_VERSION_LEGACY = 1 as const

export type BrandArchive = {
  articles: ArticleRecord[]
  movements: StockMovement[]
}

export type MagazzinoBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION | typeof BACKUP_VERSION_V2 | typeof BACKUP_VERSION_LEGACY
  exportedAt: string
  meta: {
    articleCount: number
    movementCount: number
    source: 'indexeddb-local' | 'active-data-source' | string
    brands?: BrandId[]
  }
  /** Compatibilità v1/v2 e riepilogo MR in v3. */
  articles: ArticleRecord[]
  movements: StockMovement[]
  /** Presente dalla v3: un archivio indipendente per brand. */
  archives?: Partial<Record<BrandId, BrandArchive>>
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

function parseArticlesArray(raw: unknown, label: string): ArticleRecord[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${label}: elenco articoli non valido.`)
  }
  const articles: ArticleRecord[] = []
  for (const [index, item] of raw.entries()) {
    if (!isArticleRecord(item)) {
      throw new Error(`${label}: articolo non valido alla posizione ${index + 1}.`)
    }
    if (!item.code.trim()) {
      throw new Error(`${label}: articolo alla posizione ${index + 1} senza codice.`)
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
  return articles
}

function parseMovementsArray(raw: unknown, label: string): StockMovement[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${label}: elenco movimenti non valido.`)
  }
  const movements: StockMovement[] = []
  for (const [index, item] of raw.entries()) {
    if (!isMovementRecord(item)) {
      throw new Error(`${label}: movimento non valido alla posizione ${index + 1}.`)
    }
    movements.push(
      normalizeStockMovement({
        ...item,
        supplier: typeof item.supplier === 'string' ? item.supplier : '',
        reason: typeof item.reason === 'string' ? item.reason : '',
      }),
    )
  }
  return movements
}

export function validateBackupPayload(payload: unknown): MagazzinoBackup {
  if (!isRecord(payload)) {
    throw new Error('Il file di backup non contiene un oggetto JSON valido.')
  }

  if (payload.format !== BACKUP_FORMAT) {
    throw new Error('Formato backup non riconosciuto. Atteso: magazzino-mr-backup.')
  }

  const version = payload.version
  if (
    version !== BACKUP_VERSION &&
    version !== BACKUP_VERSION_V2 &&
    version !== BACKUP_VERSION_LEGACY
  ) {
    throw new Error(
      `Versione backup non supportata (${String(version)}). Supportate: ${BACKUP_VERSION_LEGACY}, ${BACKUP_VERSION_V2}, ${BACKUP_VERSION}.`,
    )
  }

  if (typeof payload.exportedAt !== 'string' || !payload.exportedAt.trim()) {
    throw new Error('Metadato exportedAt mancante o non valido.')
  }

  if (!isRecord(payload.meta) || typeof payload.meta.articleCount !== 'number') {
    throw new Error('Metadati del backup incompleti o non validi.')
  }

  if (version === BACKUP_VERSION) {
    if (!isRecord(payload.archives)) {
      throw new Error('Il backup v3 non contiene la mappa archives per brand.')
    }

    const archives: Partial<Record<BrandId, BrandArchive>> = {}
    let totalArticles = 0
    let totalMovements = 0
    const presentBrands: BrandId[] = []

    for (const brandId of BRAND_IDS) {
      const rawArchive = payload.archives[brandId]
      if (rawArchive == null) {
        archives[brandId] = { articles: [], movements: [] }
        presentBrands.push(brandId)
        continue
      }
      if (!isRecord(rawArchive)) {
        throw new Error(`Archivio brand “${brandId}” non valido.`)
      }
      const articles = parseArticlesArray(rawArchive.articles, `Brand ${brandId}`)
      const movements = parseMovementsArray(rawArchive.movements, `Brand ${brandId}`)
      archives[brandId] = { articles, movements }
      totalArticles += articles.length
      totalMovements += movements.length
      presentBrands.push(brandId)
    }

    // Compatibilità flat: preferisci marina-raphael, altrimenti somma già calcolata in meta.
    const mr = archives[DEFAULT_BRAND_ID] ?? { articles: [], movements: [] }

    if (payload.meta.articleCount !== totalArticles) {
      throw new Error(
        `Il conteggio metadati articoli (${payload.meta.articleCount}) non corrisponde al totale archivi (${totalArticles}).`,
      )
    }
    if (
      typeof payload.meta.movementCount === 'number' &&
      payload.meta.movementCount !== totalMovements
    ) {
      throw new Error(
        `Il conteggio metadati movimenti (${payload.meta.movementCount}) non corrisponde al totale archivi (${totalMovements}).`,
      )
    }

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: payload.exportedAt,
      meta: {
        articleCount: totalArticles,
        movementCount: totalMovements,
        source: 'indexeddb-local',
        brands: presentBrands,
      },
      articles: mr.articles,
      movements: mr.movements,
      archives,
    }
  }

  // v1 / v2 → solo Marina Raphael (archivi flat).
  const articles = parseArticlesArray(payload.articles, 'Backup')
  if (payload.meta.articleCount !== articles.length) {
    throw new Error(
      `Il conteggio metadati (${payload.meta.articleCount}) non corrisponde agli articoli (${articles.length}).`,
    )
  }

  let movements: StockMovement[] = []
  if (version === BACKUP_VERSION_LEGACY) {
    movements = []
  } else {
    movements = parseMovementsArray(payload.movements, 'Backup')
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
      brands: [DEFAULT_BRAND_ID],
    },
    articles,
    movements,
    archives: {
      [DEFAULT_BRAND_ID]: { articles, movements },
    },
  }
}

async function buildBackupFromLoader(
  loadArticles: (brandId: BrandId) => Promise<ArticleRecord[]>,
  loadMovements: (brandId: BrandId) => Promise<StockMovement[]>,
  source: string,
): Promise<MagazzinoBackup> {
  const archives: Partial<Record<BrandId, BrandArchive>> = {}
  let totalArticles = 0
  let totalMovements = 0

  for (const brand of BRAND_DEFINITIONS) {
    const [rawArticles, movements] = await Promise.all([
      loadArticles(brand.id),
      loadMovements(brand.id),
    ])
    const articles = reconcileArticlesWithMovements(rawArticles, movements)
    archives[brand.id] = { articles, movements }
    totalArticles += articles.length
    totalMovements += movements.length
  }

  const mr = archives[DEFAULT_BRAND_ID] ?? { articles: [], movements: [] }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      articleCount: totalArticles,
      movementCount: totalMovements,
      source,
      brands: [...BRAND_IDS],
    },
    articles: mr.articles,
    movements: mr.movements,
    archives,
  }
}

/** Backup dalla sorgente attiva (IndexedDB o Firestore). */
export async function createArticlesBackup(): Promise<MagazzinoBackup> {
  return buildBackupFromLoader(loadAllArticles, loadAllMovements, 'active-data-source')
}

/**
 * Backup esclusivamente da IndexedDB locale (obbligatorio prima della migrazione cloud).
 * Non dipende dalla sorgente attiva.
 */
export async function createLocalIndexedDbBackup(): Promise<MagazzinoBackup> {
  return buildBackupFromLoader(loadLocalArticles, loadLocalMovements, 'indexeddb-local')
}

/**
 * Verifica che il backup sia utilizzabile come prerequisito migrazione:
 * formato v3, tre brand, almeno un articolo o un movimento.
 */
export function assertValidMigrationBackup(backup: MagazzinoBackup): MagazzinoBackup {
  const validated = validateBackupPayload(backup)
  if (validated.version !== BACKUP_VERSION) {
    throw new Error(
      `Backup migrazione non valido: richiesta versione ${BACKUP_VERSION}, trovata ${validated.version}.`,
    )
  }
  if (!validated.archives) {
    throw new Error('Backup migrazione non valido: manca archives (v3).')
  }
  for (const brandId of BRAND_IDS) {
    if (!validated.archives[brandId]) {
      throw new Error(`Backup migrazione non valido: manca archives.${brandId}.`)
    }
  }
  if (validated.meta.articleCount < 1 && validated.meta.movementCount < 1) {
    throw new Error(
      'Backup preventivo vuoto (0 articoli e 0 movimenti). Migrazione annullata.',
    )
  }
  return validated
}

export function downloadBackupJson(backup: MagazzinoBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const stamp = backup.exportedAt.slice(0, 19).replace(/[:T]/g, '-')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `magazzino-mp-backup-v${backup.version}-${stamp}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type RestoreBackupResult = {
  articleCount: number
  movementCount: number
  /** Brand effettivamente scritti. */
  brandsRestored: BrandId[]
  /** True se il backup legacy ha toccato solo Marina Raphael. */
  marinaRaphaelOnly: boolean
}

export type RestoreScope = {
  brandsToReplace: BrandId[]
  marinaRaphaelOnly: boolean
  /** Messaggio da mostrare prima della conferma esplicita. */
  overwriteWarning: string
}

/**
 * Determina quali archivi verrebbero sovrascritti, senza toccare IndexedDB.
 * - v3 → tutti e tre i brand
 * - v1/v2 → solo Marina Raphael (ES/SW intatti)
 */
export function getRestoreScope(backup: MagazzinoBackup): RestoreScope {
  if (backup.version === BACKUP_VERSION) {
    return {
      brandsToReplace: [...BRAND_IDS],
      marinaRaphaelOnly: false,
      overwriteWarning:
        'Sostituirà gli archivi di tutti e tre i brand (Marina Raphael, ELIE SAAB, Swarovski).',
    }
  }
  return {
    brandsToReplace: [DEFAULT_BRAND_ID],
    marinaRaphaelOnly: true,
    overwriteWarning:
      'Backup legacy: sostituirà solo Marina Raphael; ELIE SAAB e Swarovski restano intatti.',
  }
}

/**
 * Ripristino:
 * - v3: sostituisce ogni brand presente in archives (archivi vuoti azzerano quel brand).
 * - v1/v2: sostituisce solo Marina Raphael; ELIE SAAB e Swarovski restano intatti.
 */
export async function restoreArticlesBackup(payload: unknown): Promise<RestoreBackupResult> {
  const backup = validateBackupPayload(payload)
  const scope = getRestoreScope(backup)
  let articleCount = 0
  let movementCount = 0

  for (const brandId of scope.brandsToReplace) {
    const archive =
      backup.version === BACKUP_VERSION
        ? (backup.archives?.[brandId] ?? { articles: [], movements: [] })
        : { articles: backup.articles, movements: backup.movements }
    const a = await replaceAllArticles(archive.articles, brandId)
    const m = await replaceAllMovements(archive.movements, brandId)
    articleCount += a
    movementCount += m
  }

  return {
    articleCount,
    movementCount,
    brandsRestored: [...scope.brandsToReplace],
    marinaRaphaelOnly: scope.marinaRaphaelOnly,
  }
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

/** Utility test: verifica che un id brand sia noto. */
export function assertKnownBrandId(value: string): BrandId {
  if (!isBrandId(value)) {
    throw new Error(`Brand sconosciuto: ${value}`)
  }
  return value
}
