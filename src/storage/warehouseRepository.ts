/**
 * Facade unica IndexedDB (default) | Firestore.
 *
 * Percorso Spark (default cloud): transazioni client registerCloud*.
 * Percorso opzionale Blaze: VITE_USE_STOCK_CALLABLE=true → Callable Firebase.
 */

import type { BrandId } from '../brands/brands'
import { getActiveBrandId } from '../brands/brandPreference'
import {
  listCloudArticles,
  listCloudMovements,
} from '../cloud/warehouseRead'
import {
  persistCloudArticles,
  registerCloudCarico,
  registerCloudScarico,
} from '../cloud/warehouseWrite'
import { subscribeCloudWarehouse } from '../cloud/warehouseSubscribe'
import {
  isStockCallableRequested,
  registerCaricoViaCallable,
  registerScaricoViaCallable,
} from '../cloud/registerMovementCallable'
import type { MovementActor } from '../types/actor'
import type { ArticleRecord } from '../types/articles'
import type { CaricoInput, ScaricoInput, StockMovement } from '../types/movements'
import type { DdtDocumentIdentity } from '../ddt/ddtDocumentIdentity'
import { findMovementsForDdtDocument } from '../ddt/ddtDocumentIdentity'
import { isCloudWarehouseActive } from './dataSource'
import {
  loadAllArticles as loadLocalArticles,
  persistNewArticles as persistLocalArticles,
  replaceAllArticles as replaceLocalArticles,
  type PersistArticlesResult,
} from './articlesDb'
import {
  findCarichiForDdtDocument as findLocalCarichiForDdt,
  loadAllMovements as loadLocalMovements,
  registerCarico as registerLocalCarico,
  registerScarico as registerLocalScarico,
  replaceAllMovements as replaceLocalMovements,
  type RegisterMovementResult,
} from './movementsDb'

function resolveBrand(brandId?: BrandId): BrandId {
  return brandId ?? getActiveBrandId()
}

function requireCloudActor(actor: MovementActor | undefined): MovementActor {
  if (!actor?.uid) {
    throw new Error(
      'Per le operazioni cloud è necessario essere autenticati (UID operatore mancante).',
    )
  }
  return actor
}

export async function loadAllArticles(brandId?: BrandId): Promise<ArticleRecord[]> {
  const id = resolveBrand(brandId)
  if (isCloudWarehouseActive()) {
    return listCloudArticles(id)
  }
  return loadLocalArticles(id)
}

export async function loadAllMovements(brandId?: BrandId): Promise<StockMovement[]> {
  const id = resolveBrand(brandId)
  if (isCloudWarehouseActive()) {
    return listCloudMovements(id)
  }
  return loadLocalMovements(id)
}

export async function persistNewArticles(
  articles: ArticleRecord[],
  brandId?: BrandId,
  actor?: MovementActor,
): Promise<PersistArticlesResult> {
  const id = resolveBrand(brandId)
  if (isCloudWarehouseActive()) {
    return persistCloudArticles(articles, id, requireCloudActor(actor))
  }
  return persistLocalArticles(articles, id)
}

export async function registerCarico(
  input: CaricoInput,
  brandId?: BrandId,
  actor?: MovementActor,
): Promise<RegisterMovementResult> {
  const id = resolveBrand(brandId)
  if (isCloudWarehouseActive()) {
    const resolved = requireCloudActor(actor)
    if (isStockCallableRequested()) {
      return registerCaricoViaCallable(input, id)
    }
    return registerCloudCarico(input, id, resolved)
  }
  return registerLocalCarico(input, id, actor)
}

export async function registerScarico(
  input: ScaricoInput,
  brandId?: BrandId,
  actor?: MovementActor,
): Promise<RegisterMovementResult> {
  const id = resolveBrand(brandId)
  if (isCloudWarehouseActive()) {
    const resolved = requireCloudActor(actor)
    if (isStockCallableRequested()) {
      return registerScaricoViaCallable({ ...input, allowOverdraft: false }, id)
    }
    // Spark: overdraft non consentito in cloud.
    return registerCloudScarico({ ...input, allowOverdraft: false }, id, resolved)
  }
  return registerLocalScarico(input, id, actor)
}

export async function findCarichiForDdtDocument(
  identity: DdtDocumentIdentity,
  brandId?: BrandId,
): Promise<StockMovement[]> {
  const id = resolveBrand(brandId)
  if (isCloudWarehouseActive()) {
    const movements = await listCloudMovements(id)
    return findMovementsForDdtDocument(movements, identity)
  }
  return findLocalCarichiForDdt(identity, id)
}

export async function replaceAllArticlesLocal(
  articles: ArticleRecord[],
  brandId?: BrandId,
): Promise<number> {
  return replaceLocalArticles(articles, brandId)
}

export async function replaceAllMovementsLocal(
  movements: StockMovement[],
  brandId?: BrandId,
): Promise<number> {
  return replaceLocalMovements(movements, brandId)
}

export type WarehouseLiveHandlers = {
  onArticles: (articles: ArticleRecord[]) => void
  onMovements: (movements: StockMovement[]) => void
  onError?: (error: Error) => void
}

export function subscribeWarehouse(
  brandId: BrandId,
  handlers: WarehouseLiveHandlers,
): () => void {
  if (!isCloudWarehouseActive()) {
    return () => undefined
  }
  return subscribeCloudWarehouse(brandId, handlers)
}

export type { RegisterMovementResult, PersistArticlesResult }
export type RegisterCaricoResult = RegisterMovementResult
