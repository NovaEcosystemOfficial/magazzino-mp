import assert from 'node:assert/strict'
import {
  buildDdtRegistry,
  filterDdtRegistry,
  isDdtImportMovement,
} from '../src/ddt/buildDdtRegistry.ts'
import type { StockMovement } from '../src/types/movements.ts'

function mov(
  partial: Partial<StockMovement> &
    Pick<StockMovement, 'id' | 'documentRef' | 'supplier' | 'movementDate' | 'idempotencyKey'>,
): StockMovement {
  return {
    id: partial.id,
    type: partial.type ?? 'CARICO',
    articleId: (partial.articleCode ?? 'A1').toLowerCase(),
    articleCode: partial.articleCode ?? 'A1',
    quantity: partial.quantity ?? 1,
    movementDate: partial.movementDate,
    registeredAt: partial.registeredAt ?? '2026-10-02T10:00:00.000Z',
    supplier: partial.supplier,
    reason: '',
    documentRef: partial.documentRef,
    notes: partial.notes ?? 'Importazione DDT 798VEND',
    idempotencyKey: partial.idempotencyKey,
  }
}

const lines798 = [
  mov({
    id: 'm1',
    documentRef: '798VEND',
    supplier: 'LES BIJOUX S.R.L.',
    movementDate: '2026-10-02',
    articleCode: 'MR108-ORO',
    quantity: 6,
    idempotencyKey: 'ddt-row|798vend|les bijoux s.r.l.|2026-10-02|line:1|mr108-oro|6',
    registeredAt: '2026-10-02T11:00:00.000Z',
  }),
  mov({
    id: 'm2',
    documentRef: '798VEND',
    supplier: 'LES BIJOUX S.R.L.',
    movementDate: '2026-10-02',
    articleCode: 'MR108-GUN',
    quantity: 11,
    idempotencyKey: 'ddt-row|798vend|les bijoux s.r.l.|2026-10-02|line:2|mr108-gun|11',
    registeredAt: '2026-10-02T11:00:01.000Z',
  }),
]

// Manual carico stesso documentRef non deve entrare nel registro
const manual = mov({
  id: 'manual',
  documentRef: '798VEND',
  supplier: 'LES BIJOUX S.R.L.',
  movementDate: '2026-10-02',
  articleCode: 'OTHER',
  quantity: 99,
  notes: 'Carico manuale',
  idempotencyKey: 'carico-uuid-1',
})

const otherDdt = mov({
  id: 'm3',
  documentRef: '799VEND',
  supplier: 'LES BIJOUX S.R.L.',
  movementDate: '2026-10-03',
  articleCode: 'MR108-ORO',
  quantity: 2,
  notes: 'Importazione DDT 799VEND',
  idempotencyKey: 'ddt-row|799vend|les bijoux s.r.l.|2026-10-03|line:1|mr108-oro|2',
  registeredAt: '2026-10-03T09:00:00.000Z',
})

assert.equal(isDdtImportMovement(lines798[0]!), true)
assert.equal(isDdtImportMovement(manual), false)

const registry = buildDdtRegistry([...lines798, manual, otherDdt], [
  {
    code: 'MR108-ORO',
    description: 'moschettoni oro',
    unitOfMeasure: 'pz',
    stock: '0',
    currentStock: '6',
    status: 'attivo',
    category: '—',
    supplier: '—',
    minStock: '—',
    totalReceived: '—',
    sourceFields: {},
  },
])

// Nessuna duplicazione artificiale: 798VEND una sola volta
assert.equal(registry.length, 2)
const doc798 = registry.find((entry) => entry.documentNumber === '798VEND')
assert.ok(doc798)
assert.equal(doc798!.lineCount, 2)
assert.equal(doc798!.totalQuantity, 17)
assert.equal(doc798!.supplier, 'LES BIJOUX S.R.L.')
assert.equal(doc798!.documentDateIso, '2026-10-02')
assert.ok(doc798!.lines.some((line) => line.articleCode === 'MR108-ORO'))
assert.ok(doc798!.lines.some((line) => line.articleDescription === 'moschettoni oro'))
// Manuale escluso
assert.ok(!doc798!.lines.some((line) => line.articleCode === 'OTHER'))

// Ordinamento: più recente prima
assert.equal(registry[0]?.documentNumber, '799VEND')

// Filtri
const byNumber = filterDdtRegistry(registry, {
  query: '798',
  dateFrom: '',
  dateTo: '',
})
assert.equal(byNumber.length, 1)
assert.equal(byNumber[0]?.documentNumber, '798VEND')

const bySupplier = filterDdtRegistry(registry, {
  query: 'bijoux',
  dateFrom: '',
  dateTo: '',
})
assert.equal(bySupplier.length, 2)

const byDate = filterDdtRegistry(registry, {
  query: '',
  dateFrom: '2026-10-03',
  dateTo: '2026-10-03',
})
assert.equal(byDate.length, 1)
assert.equal(byDate[0]?.documentNumber, '799VEND')

const empty = filterDdtRegistry(registry, {
  query: 'INESISTENTE',
  dateFrom: '',
  dateTo: '',
})
assert.equal(empty.length, 0)

console.log('DDT_REGISTRY_CHECKS_OK')
