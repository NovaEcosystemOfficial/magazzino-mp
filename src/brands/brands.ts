/**
 * Brand operativi di Magazzino MP.
 * Marina Raphael usa il database IndexedDB storico `magazzino-mr` per preservare i dati esistenti.
 * ELIE SAAB e Swarovski hanno database indipendenti: nessun rischio di sovrascrittura MR.
 */

export const BRAND_IDS = ['marina-raphael', 'elie-saab', 'swarovski'] as const

export type BrandId = (typeof BRAND_IDS)[number]

export type BrandDefinition = {
  id: BrandId
  label: string
  shortLabel: string
  /** Nome IndexedDB: non cambiare per marina-raphael. */
  dbName: string
}

export const BRAND_DEFINITIONS: readonly BrandDefinition[] = [
  {
    id: 'marina-raphael',
    label: 'Marina Raphael',
    shortLabel: 'MR',
    dbName: 'magazzino-mr',
  },
  {
    id: 'elie-saab',
    label: 'ELIE SAAB',
    shortLabel: 'ES',
    dbName: 'magazzino-mp-elie-saab',
  },
  {
    id: 'swarovski',
    label: 'Swarovski',
    shortLabel: 'SW',
    dbName: 'magazzino-mp-swarovski',
  },
] as const

export const DEFAULT_BRAND_ID: BrandId = 'marina-raphael'

export function isBrandId(value: unknown): value is BrandId {
  return typeof value === 'string' && (BRAND_IDS as readonly string[]).includes(value)
}

export function getBrandDefinition(brandId: BrandId): BrandDefinition {
  const found = BRAND_DEFINITIONS.find((brand) => brand.id === brandId)
  if (!found) {
    throw new Error(`Brand non supportato: ${String(brandId)}`)
  }
  return found
}

export function getBrandLabel(brandId: BrandId): string {
  return getBrandDefinition(brandId).label
}
