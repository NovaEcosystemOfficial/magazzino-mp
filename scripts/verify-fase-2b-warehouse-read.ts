/**
 * Verifica Fase 2B — lettura sola Firestore (mock, senza rete / senza scritture).
 *
 * Esecuzione: npx tsx scripts/verify-fase-2b-warehouse-read.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRAND_IDS } from '../src/brands/brands.ts'
import {
  CloudWarehouseReadError,
  isPermissionDeniedReadError,
  mapFirestoreReadError,
} from '../src/cloud/firestoreReadErrors.ts'
import {
  parseCloudArticleDocument,
  parseCloudMovementDocument,
} from '../src/cloud/parseCloudDocuments.ts'
import {
  articleDocPath,
  articlesCollectionPath,
  movementDocPath,
  movementsCollectionPath,
  pathsBelongToDifferentBrands,
} from '../src/cloud/paths.ts'
import {
  getCloudArticle,
  getCloudMovement,
  listCloudArticles,
  listCloudMovements,
  type CloudDocumentRow,
  type WarehouseReadGateway,
} from '../src/cloud/warehouseRead.ts'
import { CLOUD_WAREHOUSE_ENABLED, getActiveDataSource } from '../src/storage/dataSource.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function permissionDeniedError(): Error & { code: string } {
  const err = new Error('Missing or insufficient permissions.') as Error & { code: string }
  err.code = 'permission-denied'
  return err
}

function memoryGateway(store: Map<string, CloudDocumentRow[]>): WarehouseReadGateway {
  return {
    async listDocuments(collectionPath: string) {
      return store.get(collectionPath) ?? []
    },
    async getDocument(documentPath: string) {
      const parts = documentPath.split('/')
      const id = parts[parts.length - 1]!
      const collectionPath = parts.slice(0, -1).join('/')
      const rows = store.get(collectionPath) ?? []
      return rows.find((row) => row.id === id) ?? null
    },
  }
}

function denyingGateway(): WarehouseReadGateway {
  return {
    async listDocuments(collectionPath: string) {
      throw Object.assign(permissionDeniedError(), { path: collectionPath })
    },
    async getDocument(documentPath: string) {
      throw Object.assign(permissionDeniedError(), { path: documentPath })
    },
  }
}

// ——— 1) Path isolati ———
for (const brandId of BRAND_IDS) {
  assert.equal(articlesCollectionPath(brandId), `brands/${brandId}/articles`)
  assert.equal(movementsCollectionPath(brandId), `brands/${brandId}/movements`)
  assert.equal(articleDocPath(brandId, 'abc'), `brands/${brandId}/articles/abc`)
  assert.equal(movementDocPath(brandId, 'idem-1'), `brands/${brandId}/movements/idem-1`)
}
assert.ok(
  pathsBelongToDifferentBrands(
    articlesCollectionPath('marina-raphael'),
    articlesCollectionPath('elie-saab'),
  ),
)
assert.notEqual(movementsCollectionPath('elie-saab'), movementsCollectionPath('swarovski'))

// ——— 2) Parse ———
const article = parseCloudArticleDocument('code-1', {
  code: 'CODE-1',
  codeKey: 'code-1',
  description: 'Prova',
  unitOfMeasure: 'pz',
  stock: '10',
  currentStock: '12',
  status: 'attivo',
  category: '—',
  supplier: '—',
  minStock: '—',
  totalReceived: '—',
  sourceFields: { Col: 'val' },
})
assert.equal(article.code, 'CODE-1')
assert.equal(article.codeKey, 'code-1')

const movement = parseCloudMovementDocument('idem-1', {
  id: 'idem-1',
  type: 'CARICO',
  articleId: 'code-1',
  articleCode: 'CODE-1',
  quantity: 2,
  movementDate: '2026-10-16',
  registeredAt: '2026-10-16T10:00:00.000Z',
  supplier: 'F',
  reason: '',
  documentRef: 'D1',
  notes: '',
  idempotencyKey: 'idem-1',
  performedByUid: 'uid-1',
  performedByUsername: 'operatore',
})
assert.equal(movement.performedByUid, 'uid-1')

assert.throws(
  () =>
    parseCloudMovementDocument('bad', {
      type: 'CARICO',
      articleId: '',
      articleCode: '',
      quantity: 1,
    }),
  (err: unknown) => err instanceof CloudWarehouseReadError && err.code === 'invalid-argument',
)

// ——— 3) Letture autorizzate (gateway in-memory) ———
const store = new Map<string, CloudDocumentRow[]>()
store.set(articlesCollectionPath('marina-raphael'), [
  {
    id: 'mr-1',
    data: {
      code: 'MR-1',
      codeKey: 'mr-1',
      description: 'MR',
      unitOfMeasure: 'pz',
      stock: '5',
      currentStock: '5',
      status: 'attivo',
      category: '—',
      supplier: '—',
      minStock: '—',
      totalReceived: '—',
      sourceFields: {},
    },
  },
])
store.set(movementsCollectionPath('elie-saab'), [
  {
    id: 'es-m1',
    data: {
      id: 'es-m1',
      type: 'SCARICO',
      articleId: 'es-1',
      articleCode: 'ES-1',
      quantity: 1,
      movementDate: '2026-10-16',
      registeredAt: '2026-10-16T12:00:00.000Z',
      supplier: '',
      reason: 'Prelievo interno',
      documentRef: '',
      notes: '',
      idempotencyKey: 'es-m1',
      performedByUid: 'uid-op',
      performedByUsername: 'op',
    },
  },
])
store.set(articlesCollectionPath('swarovski'), [])
store.set(movementsCollectionPath('swarovski'), [])

const gateway = memoryGateway(store)

const mrArticles = await listCloudArticles('marina-raphael', { gateway })
assert.equal(mrArticles.length, 1)
assert.equal(mrArticles[0]?.code, 'MR-1')

const esOnly = await listCloudMovements('elie-saab', { gateway })
assert.equal(esOnly.length, 1)
assert.equal(esOnly[0]?.articleCode, 'ES-1')

// Isolamento: MR articles non “vedono” movimenti ES
const mrMovements = await listCloudMovements('marina-raphael', { gateway })
assert.equal(mrMovements.length, 0)

const swArticles = await listCloudArticles('swarovski', { gateway })
assert.equal(swArticles.length, 0)

const oneArticle = await getCloudArticle('marina-raphael', 'mr-1', { gateway })
assert.equal(oneArticle?.code, 'MR-1')
assert.equal(await getCloudArticle('marina-raphael', 'missing', { gateway }), null)

const oneMovement = await getCloudMovement('elie-saab', 'es-m1', { gateway })
assert.equal(oneMovement?.idempotencyKey, 'es-m1')
assert.equal(await getCloudMovement('elie-saab', 'missing', { gateway }), null)

await assert.rejects(
  () => getCloudArticle('marina-raphael', '  ', { gateway }),
  (err: unknown) => err instanceof CloudWarehouseReadError && err.code === 'invalid-argument',
)

// Brand non valido
assert.throws(() => articlesCollectionPath('altro' as never))

// ——— 4) Errori (permission-denied / rete) ———
const denied = denyingGateway()
await assert.rejects(
  () => listCloudArticles('marina-raphael', { gateway: denied }),
  (err: unknown) =>
    err instanceof CloudWarehouseReadError &&
    err.code === 'permission-denied' &&
    isPermissionDeniedReadError(err),
)

await assert.rejects(
  () => listCloudMovements('swarovski', { gateway: denied }),
  (err: unknown) => err instanceof CloudWarehouseReadError && err.code === 'permission-denied',
)

const mappedUnauth = mapFirestoreReadError(
  Object.assign(new Error('auth'), { code: 'unauthenticated' }),
  { brandId: 'marina-raphael', path: 'brands/marina-raphael/articles' },
)
assert.equal(mappedUnauth.code, 'unauthenticated')

const mappedUnavailable = mapFirestoreReadError(
  Object.assign(new Error('down'), { code: 'unavailable' }),
  { brandId: 'elie-saab', path: 'brands/elie-saab/movements' },
)
assert.equal(mappedUnavailable.code, 'unavailable')

// ——— 5) Rules pubblicate / bozza: brands deny; nessun deploy involontario ———
const loginRules = readFileSync(join(root, 'firestore.rules.proposal'), 'utf8')
assert.match(loginRules, /match \/brands\/\{brandId\}\/\{document=\*\*\}/)
assert.match(loginRules, /allow read, write: if false/)

const cloudRules = readFileSync(join(root, 'firestore.rules.cloud-warehouse.proposal'), 'utf8')
assert.match(cloudRules, /NON PUBBLICARE/)

// Modulo lettura: solo get, nessuna API di scrittura
const warehouseSrc = readFileSync(join(root, 'src/cloud/warehouseRead.ts'), 'utf8')
for (const banned of ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
  assert.equal(warehouseSrc.includes(banned), false, `warehouseRead non deve usare ${banned}`)
}

// Schermate operative non collegate
for (const relative of [
  'src/App.tsx',
  'src/components/CarichiView.tsx',
  'src/components/ScarichiView.tsx',
  'src/components/DdtImportView.tsx',
  'src/storage/articlesDb.ts',
  'src/storage/movementsDb.ts',
]) {
  const src = readFileSync(join(root, relative), 'utf8')
  assert.equal(src.includes('listCloudArticles'), false, relative)
  assert.equal(src.includes('listCloudMovements'), false, relative)
  assert.equal(src.includes('warehouseRead'), false, relative)
}

// IndexedDB resta ufficiale
assert.equal(CLOUD_WAREHOUSE_ENABLED, false)
assert.equal(getActiveDataSource(), 'indexeddb')

console.log('FASE_2B_WAREHOUSE_READ_CHECKS_OK')
console.log(
  'NOTE: regole pubblicate (fase login) negano brands/** → lettura live = permission-denied finché non si pubblica una policy di sola lettura approvata.',
)
