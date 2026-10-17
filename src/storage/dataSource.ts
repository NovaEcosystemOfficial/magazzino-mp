/**
 * Sorgente dati magazzino: IndexedDB (default) o Firestore.
 *
 * Attivazione cloud (tutte necessarie):
 * 1. VITE_CLOUD_WAREHOUSE_ENABLED=true
 * 2. VITE_DATA_SOURCE=firestore  e/o preferenza runtime admin
 * 3. Security Rules cloud pubblicate manualmente (non da questa app)
 */

export const DATA_SOURCES = ['indexeddb', 'firestore'] as const

export type DataSource = (typeof DATA_SOURCES)[number]

const RUNTIME_PREFERENCE_KEY = 'magazzino-mp-data-source'

/** True se il build consente l’uso del cloud (env). Default false. */
export function isCloudWarehouseBuildEnabled(): boolean {
  const raw =
    typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_CLOUD_WAREHOUSE_ENABLED
      : undefined
  return String(raw ?? '').trim().toLowerCase() === 'true'
}

/**
 * Compatibilità con codice/test Fase 2A: false finché l’env non abilita il cloud.
 * Non implica che Firestore sia la sorgente attiva.
 */
export const CLOUD_WAREHOUSE_ENABLED = isCloudWarehouseBuildEnabled()

export function parseDataSourcePreference(raw: string | undefined | null): DataSource {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === '' || value === 'indexeddb') {
    return 'indexeddb'
  }
  if (value === 'firestore') {
    return 'firestore'
  }
  throw new Error(
    `VITE_DATA_SOURCE non valido: "${raw}". Valori ammessi: indexeddb, firestore.`,
  )
}

export function getConfiguredDataSourcePreference(
  envValue: string | undefined = typeof import.meta !== 'undefined'
    ? import.meta.env?.VITE_DATA_SOURCE
    : undefined,
): DataSource {
  return parseDataSourcePreference(envValue)
}

function readRuntimePreference(): DataSource | null {
  if (typeof localStorage === 'undefined') {
    return null
  }
  try {
    const raw = localStorage.getItem(RUNTIME_PREFERENCE_KEY)
    if (raw === 'indexeddb' || raw === 'firestore') {
      return raw
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Sorgente effettivamente usata.
 * Default sicuro: indexeddb. Firestore solo se build abilitata + preferenza.
 */
export function getActiveDataSource(): DataSource {
  if (!isCloudWarehouseBuildEnabled()) {
    return 'indexeddb'
  }
  const runtime = readRuntimePreference()
  if (runtime) {
    return runtime
  }
  return getConfiguredDataSourcePreference()
}

export function isCloudWarehouseActive(): boolean {
  return getActiveDataSource() === 'firestore'
}

/**
 * Preferenza runtime (admin). Richiede VITE_CLOUD_WAREHOUSE_ENABLED=true.
 * Reversibile: impostare di nuovo `indexeddb`.
 */
export function setRuntimeDataSource(source: DataSource): void {
  if (!isCloudWarehouseBuildEnabled()) {
    throw new Error(
      'Cloud non abilitato in questo build. Impostare VITE_CLOUD_WAREHOUSE_ENABLED=true e ridistribuire.',
    )
  }
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage non disponibile.')
  }
  localStorage.setItem(RUNTIME_PREFERENCE_KEY, source)
}

export function clearRuntimeDataSource(): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.removeItem(RUNTIME_PREFERENCE_KEY)
  } catch {
    // ignore
  }
}

export function getRuntimeDataSource(): DataSource | null {
  return readRuntimePreference()
}

/**
 * Stato garanzia stock (percorso Spark di default).
 * - clientTransaction: runTransaction client su articolo+movimento
 * - serverEnforcedNonNegative: solo con backend Admin (Callable Blaze o API esterna)
 * - requiresBlazeCallable / cloudRequiresCallable: false sul percorso Spark
 */
export const STOCK_ATOMICITY_STATUS = {
  clientTransaction: true,
  serverEnforcedNonNegative: false,
  requiresBlazeCallable: false,
  cloudRequiresCallable: false,
} as const

export function isStockCallableEnvRequested(): boolean {
  const raw =
    typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_USE_STOCK_CALLABLE
      : undefined
  return String(raw ?? '').trim().toLowerCase() === 'true'
}
