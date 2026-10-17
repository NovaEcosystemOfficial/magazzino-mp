/**
 * Lettura sola Firestore per articoli e movimenti per-marca (Fase 2B).
 *
 * - Non collega le schermate operative.
 * - Non esegue scritture / migrazioni.
 * - IndexedDB resta la sorgente ufficiale dell’app.
 *
 * Attenzione: con le regole pubblicate di fase login (`brands/**` deny)
 * ogni lettura reale termina con `permission-denied`.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Firestore,
} from 'firebase/firestore'
import type { BrandId } from '../brands/brands'
import { getFirebaseFirestore } from '../firebase/firestore'
import type { CloudArticleDocument, CloudMovementDocument } from '../types/cloudWarehouse'
import {
  articleDocPath,
  articlesCollectionPath,
  assertCloudBrandId,
  movementDocPath,
  movementsCollectionPath,
} from './paths'
import { parseCloudArticleDocument, parseCloudMovementDocument } from './parseCloudDocuments'
import {
  CloudWarehouseReadError,
  mapFirestoreReadError,
} from './firestoreReadErrors'

export type CloudDocumentRow = {
  id: string
  data: Record<string, unknown>
}

/**
 * Porta di lettura astratta (path stringa `brands/{brandId}/...`).
 * Permette test senza rete e senza istanza Firebase.
 */
export type WarehouseReadGateway = {
  listDocuments(collectionPath: string): Promise<CloudDocumentRow[]>
  getDocument(documentPath: string): Promise<CloudDocumentRow | null>
}

export type WarehouseReadOptions = {
  db?: Firestore
  gateway?: WarehouseReadGateway
}

function splitPath(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) {
    throw new CloudWarehouseReadError(
      'invalid-argument',
      `Path Firestore non valido: ${path}`,
      { path },
    )
  }
  return parts
}

/** Gateway SDK reale (sola lettura getDocs / getDoc). */
export function createFirestoreWarehouseGateway(db?: Firestore): WarehouseReadGateway {
  const firestore = db ?? getFirebaseFirestore()
  return {
    async listDocuments(collectionPath: string): Promise<CloudDocumentRow[]> {
      const segments = splitPath(collectionPath)
      const snap = await getDocs(collection(firestore, ...(segments as [string, ...string[]])))
      return snap.docs.map((row) => ({
        id: row.id,
        data: row.data() as Record<string, unknown>,
      }))
    },
    async getDocument(documentPath: string): Promise<CloudDocumentRow | null> {
      const segments = splitPath(documentPath)
      const snap = await getDoc(doc(firestore, ...(segments as [string, ...string[]])))
      if (!snap.exists()) {
        return null
      }
      return {
        id: snap.id,
        data: snap.data() as Record<string, unknown>,
      }
    },
  }
}

function resolveGateway(options?: WarehouseReadOptions): WarehouseReadGateway {
  if (options?.gateway) {
    return options.gateway
  }
  return createFirestoreWarehouseGateway(options?.db)
}

/** Elenca articoli cloud di una marca (sola lettura). */
export async function listCloudArticles(
  brandId: BrandId,
  options?: WarehouseReadOptions,
): Promise<CloudArticleDocument[]> {
  const id = assertCloudBrandId(brandId)
  const path = articlesCollectionPath(id)
  try {
    const rows = await resolveGateway(options).listDocuments(path)
    return rows.map((row) => parseCloudArticleDocument(row.id, row.data))
  } catch (error) {
    throw mapFirestoreReadError(error, { brandId: id, path })
  }
}

/** Legge un articolo cloud; `null` se assente. */
export async function getCloudArticle(
  brandId: BrandId,
  codeKey: string,
  options?: WarehouseReadOptions,
): Promise<CloudArticleDocument | null> {
  const id = assertCloudBrandId(brandId)
  const key = codeKey.trim()
  if (!key) {
    throw new CloudWarehouseReadError('invalid-argument', 'codeKey articolo vuoto', {
      brandId: id,
    })
  }
  const path = articleDocPath(id, key)
  try {
    const row = await resolveGateway(options).getDocument(path)
    if (!row) {
      return null
    }
    return parseCloudArticleDocument(row.id, row.data)
  } catch (error) {
    throw mapFirestoreReadError(error, { brandId: id, path })
  }
}

/** Elenca movimenti cloud di una marca (sola lettura). */
export async function listCloudMovements(
  brandId: BrandId,
  options?: WarehouseReadOptions,
): Promise<CloudMovementDocument[]> {
  const id = assertCloudBrandId(brandId)
  const path = movementsCollectionPath(id)
  try {
    const rows = await resolveGateway(options).listDocuments(path)
    return rows.map((row) => parseCloudMovementDocument(row.id, row.data))
  } catch (error) {
    throw mapFirestoreReadError(error, { brandId: id, path })
  }
}

/** Legge un movimento cloud; `null` se assente. */
export async function getCloudMovement(
  brandId: BrandId,
  movementId: string,
  options?: WarehouseReadOptions,
): Promise<CloudMovementDocument | null> {
  const id = assertCloudBrandId(brandId)
  const mid = movementId.trim()
  if (!mid) {
    throw new CloudWarehouseReadError('invalid-argument', 'movementId vuoto', {
      brandId: id,
    })
  }
  const path = movementDocPath(id, mid)
  try {
    const row = await resolveGateway(options).getDocument(path)
    if (!row) {
      return null
    }
    return parseCloudMovementDocument(row.id, row.data)
  } catch (error) {
    throw mapFirestoreReadError(error, { brandId: id, path })
  }
}
