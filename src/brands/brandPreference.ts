import { DEFAULT_BRAND_ID, isBrandId, type BrandId } from './brands'

/** Preferenza UI: brand attivo. Non cancella né migra IndexedDB. */
export const ACTIVE_BRAND_STORAGE_KEY = 'magazzino-mp-active-brand'

export function getActiveBrandId(): BrandId {
  try {
    const raw = localStorage.getItem(ACTIVE_BRAND_STORAGE_KEY)
    if (isBrandId(raw)) {
      return raw
    }
  } catch {
    // localStorage non disponibile
  }
  return DEFAULT_BRAND_ID
}

export function setActiveBrandId(brandId: BrandId): void {
  try {
    localStorage.setItem(ACTIVE_BRAND_STORAGE_KEY, brandId)
  } catch {
    // Ignora: la sessione userà comunque il brand passato allo state React.
  }
}
