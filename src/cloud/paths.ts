import { isBrandId, type BrandId } from '../brands/brands'

/**
 * Path Firestore per archivi per-marca.
 * Isolamento: ogni brandId ha un sottoalbero dedicato; nessun path condiviso.
 */

export const CLOUD_BRANDS_COLLECTION = 'brands'
export const CLOUD_ARTICLES_COLLECTION = 'articles'
export const CLOUD_MOVEMENTS_COLLECTION = 'movements'
export const CLOUD_META_COLLECTION = 'meta'

export function assertCloudBrandId(brandId: string): BrandId {
  if (!isBrandId(brandId)) {
    throw new Error(`BrandId Firestore non valido: ${brandId}`)
  }
  return brandId
}

export function brandRootPath(brandId: BrandId): string {
  assertCloudBrandId(brandId)
  return `${CLOUD_BRANDS_COLLECTION}/${brandId}`
}

export function articlesCollectionPath(brandId: BrandId): string {
  return `${brandRootPath(brandId)}/${CLOUD_ARTICLES_COLLECTION}`
}

export function articleDocPath(brandId: BrandId, codeKey: string): string {
  const key = codeKey.trim()
  if (!key) {
    throw new Error('codeKey articolo vuoto')
  }
  return `${articlesCollectionPath(brandId)}/${key}`
}

export function movementsCollectionPath(brandId: BrandId): string {
  return `${brandRootPath(brandId)}/${CLOUD_MOVEMENTS_COLLECTION}`
}

/**
 * Id documento movimento = idempotencyKey (anti-duplicato via create-only).
 */
export function movementDocPath(brandId: BrandId, movementId: string): string {
  const id = movementId.trim()
  if (!id) {
    throw new Error('movementId vuoto')
  }
  return `${movementsCollectionPath(brandId)}/${id}`
}

export function metaDocPath(brandId: BrandId, docId: string): string {
  const id = docId.trim()
  if (!id) {
    throw new Error('meta docId vuoto')
  }
  return `${brandRootPath(brandId)}/${CLOUD_META_COLLECTION}/${id}`
}

/** True se due path appartengono a marche diverse (isolamento). */
export function pathsBelongToDifferentBrands(pathA: string, pathB: string): boolean {
  const brandA = extractBrandIdFromPath(pathA)
  const brandB = extractBrandIdFromPath(pathB)
  return brandA !== null && brandB !== null && brandA !== brandB
}

export function extractBrandIdFromPath(path: string): BrandId | null {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== CLOUD_BRANDS_COLLECTION || !parts[1]) {
    return null
  }
  return isBrandId(parts[1]) ? parts[1] : null
}
