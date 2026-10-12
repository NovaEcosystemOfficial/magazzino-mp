import assert from 'node:assert/strict'
import { validateBackupPayload } from '../src/storage/backup.ts'
import { normalizeStockMovement, SCARICO_REASONS } from '../src/types/movements.ts'
import {
  parseQuantityInput,
  stockCoversQuantity,
  subtractQuantities,
} from '../src/utils/quantity.ts'

// Quantità valida / rifiuti
assert.equal(parseQuantityInput('6').ok, true)
assert.equal(parseQuantityInput('').ok, false)
assert.equal(parseQuantityInput('0').ok, false)
assert.equal(parseQuantityInput('-3').ok, false)
assert.equal(parseQuantityInput('abc').ok, false)

// Giacenza: copertura e sottrazione
assert.equal(stockCoversQuantity('10', 6), true)
assert.equal(stockCoversQuantity('10', 10), true)
assert.equal(stockCoversQuantity('10', 11), false)
assert.equal(stockCoversQuantity('—', 1), false)
assert.equal(subtractQuantities('10', 6), '4')
assert.equal(subtractQuantities('11', 11), '0')
assert.throws(() => subtractQuantities('5', -1))

// Causali previste
for (const reason of [
  'Prelievo interno',
  'Utilizzo produzione',
  'Reso al fornitore',
  'Altro',
]) {
  assert.ok((SCARICO_REASONS as readonly string[]).includes(reason))
}

// Legacy movimento senza reason
const legacy = normalizeStockMovement({
  id: '1',
  type: 'CARICO',
  articleId: 'x',
  articleCode: 'X',
  quantity: 1,
  movementDate: '2026-10-01',
  registeredAt: '2026-10-01T00:00:00.000Z',
  supplier: 'Fornitore',
  documentRef: 'DOC1',
  notes: '',
  idempotencyKey: 'k1',
})
assert.equal(legacy.reason, '')
assert.equal(legacy.type, 'CARICO')

// Backup v1 compatibile (senza movimenti)
const v1 = validateBackupPayload({
  format: 'magazzino-mr-backup',
  version: 1,
  exportedAt: '2026-10-12T00:00:00.000Z',
  meta: { articleCount: 1, source: 'indexeddb-local' },
  articles: [
    {
      code: 'A1',
      description: 'Test',
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
  ],
})
assert.equal(v1.movements.length, 0)
assert.equal(v1.meta.movementCount, 0)

// Backup v2 con scarico
const v2 = validateBackupPayload({
  format: 'magazzino-mr-backup',
  version: 2,
  exportedAt: '2026-10-12T00:00:00.000Z',
  meta: { articleCount: 1, movementCount: 1, source: 'indexeddb-local' },
  articles: v1.articles,
  movements: [
    {
      id: 'm1',
      type: 'SCARICO',
      articleId: 'a1',
      articleCode: 'A1',
      quantity: 2,
      movementDate: '2026-10-12',
      registeredAt: '2026-10-12T10:00:00.000Z',
      supplier: '',
      reason: 'Prelievo interno',
      documentRef: '',
      notes: '',
      idempotencyKey: 'scarico-1',
    },
  ],
})
assert.equal(v2.movements.length, 1)
assert.equal(v2.movements[0]?.type, 'SCARICO')
assert.equal(v2.movements[0]?.reason, 'Prelievo interno')

console.log('SCARICHI_CHECKS_OK')
