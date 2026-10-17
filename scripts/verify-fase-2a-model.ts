/**
 * Verifica offline del modello Fase 2A:
 * - isolamento path per marca
 * - immutabilità movimenti (anche admin)
 * - identità operatore = Auth UID
 * - feature flag IndexedDB attivo
 * - bozza rules allineata
 * - stock ≥ 0 multi-PC NON dichiarato garantito senza backend/Blaze
 *
 * Esecuzione: npx tsx scripts/verify-fase-2a-model.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canCreateMovement,
  canDeleteMovement,
  canReadMovements,
  canUpdateMovement,
  isValidMovementCreatePayload,
  NON_NEGATIVE_STOCK_ATOMIC_REQUIRES_BACKEND_OR_BLAZE,
  NON_NEGATIVE_STOCK_MULTI_PC_GUARANTEED_BY_RULES,
  type AccessPrincipal,
} from '../src/cloud/accessPolicy.ts'
import {
  articleDocPath,
  extractBrandIdFromPath,
  movementDocPath,
  movementsCollectionPath,
  pathsBelongToDifferentBrands,
} from '../src/cloud/paths.ts'
import { BRAND_IDS } from '../src/brands/brands.ts'
import {
  CLOUD_WAREHOUSE_ENABLED,
  getActiveDataSource,
  getConfiguredDataSourcePreference,
  isCloudWarehouseActive,
  parseDataSourcePreference,
} from '../src/storage/dataSource.ts'
import type { UserProfile } from '../src/types/auth.ts'
import type { CloudMovementDocument } from '../src/types/cloudWarehouse.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function profile(
  uid: string,
  role: UserProfile['role'],
  active = true,
): UserProfile {
  return {
    uid,
    username: role === 'admin' ? 'admin' : 'operatore',
    displayName: role === 'admin' ? 'Admin' : 'Operatore',
    role,
    active,
  }
}

function principal(uid: string, role: UserProfile['role'], active = true): AccessPrincipal {
  return { uid, profile: profile(uid, role, active) }
}

function sampleMovement(
  overrides: Partial<CloudMovementDocument> &
    Pick<CloudMovementDocument, 'id' | 'performedByUid'> = {
    id: 'idem-carico-1',
    performedByUid: 'uid-op-1',
  },
): CloudMovementDocument {
  const id = overrides.id
  return {
    id,
    type: overrides.type ?? 'CARICO',
    articleId: overrides.articleId ?? 'art-1',
    articleCode: overrides.articleCode ?? 'ART-1',
    quantity: overrides.quantity ?? 2,
    movementDate: overrides.movementDate ?? '2026-10-16',
    registeredAt: overrides.registeredAt ?? '2026-10-16T10:00:00.000Z',
    supplier: overrides.supplier ?? 'Fornitore',
    reason: overrides.reason ?? '',
    documentRef: overrides.documentRef ?? 'DDT-1',
    notes: overrides.notes ?? '',
    idempotencyKey: overrides.idempotencyKey ?? id,
    performedByUid: overrides.performedByUid,
    performedByUsername: overrides.performedByUsername ?? 'operatore',
  }
}

// ——— 1) Isolamento path marche ———
const pathsByBrand = new Map<string, string>()
for (const brandId of BRAND_IDS) {
  const articles = articleDocPath(brandId, 'code-a')
  const movements = movementDocPath(brandId, 'idem-1')
  assert.equal(extractBrandIdFromPath(articles), brandId)
  assert.equal(extractBrandIdFromPath(movements), brandId)
  assert.match(articles, new RegExp(`^brands/${brandId}/articles/`))
  assert.match(movements, new RegExp(`^brands/${brandId}/movements/`))
  pathsByBrand.set(brandId, movementsCollectionPath(brandId))
}

assert.equal(pathsByBrand.size, 3)
assert.ok(
  pathsBelongToDifferentBrands(
    movementDocPath('marina-raphael', 'x'),
    movementDocPath('elie-saab', 'x'),
  ),
)
assert.ok(
  pathsBelongToDifferentBrands(
    movementDocPath('elie-saab', 'x'),
    movementDocPath('swarovski', 'x'),
  ),
)
// Stesso idempotencyKey su marche diverse → path diversi (isolamento archivi)
assert.notEqual(
  movementDocPath('marina-raphael', 'same-key'),
  movementDocPath('swarovski', 'same-key'),
)

assert.throws(() => articleDocPath('brand-inesistente' as never, 'a'))
assert.equal(extractBrandIdFromPath('users/uid-1'), null)
assert.equal(extractBrandIdFromPath('brands/altro/movements/x'), null)

// Operatore non attivo / brand non valido → no accesso
assert.equal(canReadMovements(principal('u1', 'operator', false), 'marina-raphael'), false)
assert.equal(canReadMovements(principal('u1', 'operator'), 'brand-fake'), false)
assert.equal(canReadMovements(principal('u1', 'operator'), 'marina-raphael'), true)

// ——— 2) Immutabilità movimenti (anche admin) ———
const op = principal('uid-op-1', 'operator')
const admin = principal('uid-admin-1', 'admin')
const movement = sampleMovement({ id: 'idem-carico-1', performedByUid: 'uid-op-1' })

assert.equal(canCreateMovement(op, 'marina-raphael', movement, 'idem-carico-1'), true)
assert.equal(canUpdateMovement(op, 'marina-raphael'), false)
assert.equal(canDeleteMovement(op, 'marina-raphael'), false)
assert.equal(canUpdateMovement(admin, 'marina-raphael'), false)
assert.equal(canDeleteMovement(admin, 'marina-raphael'), false)
assert.equal(canUpdateMovement(admin, 'elie-saab'), false)
assert.equal(canDeleteMovement(admin, 'swarovski'), false)

// Create con UID altrui → deny
const spoofed = sampleMovement({ id: 'idem-carico-1', performedByUid: 'uid-altro' })
assert.equal(canCreateMovement(op, 'marina-raphael', spoofed, 'idem-carico-1'), false)
assert.equal(
  isValidMovementCreatePayload(spoofed, 'idem-carico-1', 'uid-op-1'),
  false,
)

// Idempotency: document id deve coincidere con idempotencyKey
const mismatchedKey = sampleMovement({
  id: 'doc-a',
  performedByUid: 'uid-op-1',
  idempotencyKey: 'doc-b',
})
assert.equal(canCreateMovement(op, 'marina-raphael', mismatchedKey, 'doc-a'), false)

// Quantity non valida
const badQty = sampleMovement({
  id: 'idem-bad',
  performedByUid: 'uid-op-1',
  quantity: 0,
})
assert.equal(canCreateMovement(op, 'marina-raphael', badQty, 'idem-bad'), false)

// ——— 3) Feature flag: IndexedDB attivo ———
assert.equal(CLOUD_WAREHOUSE_ENABLED, false)
assert.equal(getActiveDataSource(), 'indexeddb')
assert.equal(parseDataSourcePreference(undefined), 'indexeddb')
assert.equal(parseDataSourcePreference('indexeddb'), 'indexeddb')
assert.equal(parseDataSourcePreference('firestore'), 'firestore')
assert.equal(getConfiguredDataSourcePreference('firestore'), 'firestore')
assert.equal(isCloudWarehouseActive(), false)
assert.throws(() => parseDataSourcePreference('mysql'))

// Storage runtime non deve ancora puntare a firestore per magazzino
const articlesDbSrc = readFileSync(join(root, 'src/storage/articlesDb.ts'), 'utf8')
const movementsDbSrc = readFileSync(join(root, 'src/storage/movementsDb.ts'), 'utf8')
assert.equal(articlesDbSrc.includes('getFirebaseFirestore'), false)
assert.equal(movementsDbSrc.includes('getFirebaseFirestore'), false)
assert.equal(articlesDbSrc.includes('firebase/firestore'), false)
assert.equal(movementsDbSrc.includes('firebase/firestore'), false)
assert.equal(articlesDbSrc.includes("collection("), false)
assert.equal(movementsDbSrc.includes("collection("), false)

// ——— 4) Bozza rules cloud-warehouse ———
const cloudRules = readFileSync(
  join(root, 'firestore.rules.cloud-warehouse.proposal'),
  'utf8',
)
assert.match(cloudRules, /NON PUBBLICARE/)
assert.match(cloudRules, /marina-raphael/)
assert.match(cloudRules, /elie-saab/)
assert.match(cloudRules, /swarovski/)
assert.match(cloudRules, /performedByUid == request\.auth\.uid/)
assert.match(cloudRules, /match \/movements\/\{movementId\}/)
assert.match(cloudRules, /allow update, delete: if false/)
assert.match(cloudRules, /idempotencyKey == movementId/)
assert.doesNotMatch(cloudRules, /allow update: if isAdmin\(\)/) // movimenti: nessuno update

const loginRules = readFileSync(join(root, 'firestore.rules.proposal'), 'utf8')
assert.match(loginRules, /brands\/\{brandId\}\/\{document=\*\*\}/)
assert.match(loginRules, /allow read, write: if false/)
assert.match(loginRules, /firestore\.rules\.cloud-warehouse\.proposal/)

// ——— 5) Limite Spark: stock multi-PC ———
assert.equal(NON_NEGATIVE_STOCK_MULTI_PC_GUARANTEED_BY_RULES, false)
assert.equal(NON_NEGATIVE_STOCK_ATOMIC_REQUIRES_BACKEND_OR_BLAZE, true)

console.log('FASE_2A_MODEL_CHECKS_OK')
