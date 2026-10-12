import assert from 'node:assert/strict'
import {
  buildWarehouseReport,
  normalizeUnitForReport,
} from '../src/report/buildWarehouseReport.ts'
import { isDateInPeriod, resolveReportPeriod } from '../src/report/period.ts'
import type { ArticleRecord } from '../src/types/articles.ts'
import type { StockMovement } from '../src/types/movements.ts'

const articles: ArticleRecord[] = [
  {
    code: 'A1',
    description: 'Vite M6',
    unitOfMeasure: 'pz',
    stock: '10',
    currentStock: '8',
    status: 'attivo',
    category: '—',
    supplier: '—',
    minStock: '5',
    totalReceived: '—',
    sourceFields: {},
  },
  {
    code: 'B1',
    description: 'Olio',
    unitOfMeasure: 'l',
    stock: '2',
    currentStock: '1,5',
    status: 'attivo',
    category: '—',
    supplier: '—',
    minStock: '2',
    totalReceived: '—',
    sourceFields: {},
  },
  {
    code: 'C1',
    description: 'Senza min',
    unitOfMeasure: 'PZ',
    stock: '3',
    currentStock: '3',
    status: 'attivo',
    category: '—',
    supplier: '—',
    minStock: '—',
    totalReceived: '—',
    sourceFields: {},
  },
  {
    code: 'D1',
    description: 'Nastro',
    unitOfMeasure: 'm',
    stock: '4',
    currentStock: '4',
    status: 'attivo',
    category: '—',
    supplier: '—',
    minStock: '—',
    totalReceived: '—',
    sourceFields: {},
  },
]

const movements: StockMovement[] = [
  {
    id: '1',
    type: 'CARICO',
    articleId: 'a1',
    articleCode: 'A1',
    quantity: 4,
    movementDate: '2026-10-10',
    registeredAt: '2026-10-10T10:00:00.000Z',
    supplier: 'F1',
    reason: '',
    documentRef: 'DOC1',
    notes: '',
    idempotencyKey: 'k1',
  },
  {
    id: '2',
    type: 'SCARICO',
    articleId: 'a1',
    articleCode: 'A1',
    quantity: 1,
    movementDate: '2026-10-11',
    registeredAt: '2026-10-11T10:00:00.000Z',
    supplier: '',
    reason: 'Prelievo interno',
    documentRef: '',
    notes: '',
    idempotencyKey: 'k2',
  },
  {
    id: '3',
    type: 'CARICO',
    articleId: 'b1',
    articleCode: 'B1',
    quantity: 2,
    movementDate: '2026-09-01',
    registeredAt: '2026-09-01T10:00:00.000Z',
    supplier: 'F2',
    reason: '',
    documentRef: 'OLD',
    notes: '',
    idempotencyKey: 'k3',
  },
  {
    id: '4',
    type: 'CARICO',
    articleId: 'a1',
    articleCode: 'A1',
    quantity: 6,
    movementDate: '2026-10-02',
    registeredAt: '2026-10-02T11:00:00.000Z',
    supplier: 'LES BIJOUX S.R.L.',
    reason: '',
    documentRef: '798VEND',
    notes: 'Importazione DDT 798VEND',
    idempotencyKey: 'ddt-row|798vend|les bijoux s.r.l.|2026-10-02|line:1|a1|6',
  },
  {
    id: '5',
    type: 'CARICO',
    articleId: 'a1',
    articleCode: 'A1',
    quantity: 11,
    movementDate: '2026-10-02',
    registeredAt: '2026-10-02T11:00:01.000Z',
    supplier: 'LES BIJOUX S.R.L.',
    reason: '',
    documentRef: '798VEND',
    notes: 'Importazione DDT 798VEND',
    idempotencyKey: 'ddt-row|798vend|les bijoux s.r.l.|2026-10-02|line:2|a1|11',
  },
]

// Period helpers
const todayPeriod = resolveReportPeriod('today', '', '', '2026-10-12')
assert.deepEqual(todayPeriod, { preset: 'today', fromDate: '2026-10-12', toDate: '2026-10-12' })
const week = resolveReportPeriod('last7', '', '', '2026-10-12')
assert.equal(week.fromDate, '2026-10-06')
assert.equal(week.toDate, '2026-10-12')
const month = resolveReportPeriod('month', '', '', '2026-10-12')
assert.equal(month.fromDate, '2026-10-01')
assert.equal(isDateInPeriod('2026-10-10', month), true)
assert.equal(isDateInPeriod('2026-09-30', month), false)

const report = buildWarehouseReport(articles, movements, month)

assert.equal(report.articleCount, 4)
assert.equal(report.belowMinCount, 1) // B1 1.5 < 2
assert.ok(report.lowStockRows.some((row) => row.code === 'B1' && row.belowMin))
assert.ok(report.lowStockRows.some((row) => row.code === 'A1' && !row.belowMin))
assert.ok(!report.lowStockRows.some((row) => row.code === 'C1')) // senza min escluso dalla tabella soglia
assert.equal(report.articlesWithoutMinStock, 2)

assert.equal(normalizeUnitForReport('pz'), 'PZ')
assert.equal(normalizeUnitForReport(' PZ '), 'PZ')
assert.equal(normalizeUnitForReport('m'), 'M')

// Giacenze: "pz" e "PZ" confluiscono in un’unica riga PZ
const pzRows = report.stockByUnit.filter((row) => row.unit === 'PZ')
assert.equal(pzRows.length, 1)
assert.equal(pzRows[0]!.quantity, 11) // 8 (pz) + 3 (PZ)
const liters = report.stockByUnit.find((row) => row.unit === 'L')
assert.ok(liters)
assert.equal(liters!.quantity, 1.5)
// Unità realmente diverse restano separate
const meters = report.stockByUnit.find((row) => row.unit === 'M')
assert.ok(meters)
assert.equal(meters!.quantity, 4)
assert.ok(!report.stockByUnit.some((row) => row.unit === 'pz'))

// Anagrafica non alterata
assert.equal(articles.find((a) => a.code === 'A1')?.unitOfMeasure, 'pz')
assert.equal(articles.find((a) => a.code === 'C1')?.unitOfMeasure, 'PZ')

// Movimenti periodo (ottobre): carico A1 4+6+11, scarico 1; B1 settembre escluso
assert.equal(report.caricoCount, 3)
assert.equal(report.scaricoCount, 1)
const pzFlow = report.saldoByUnit.find((row) => row.unit === 'PZ')
assert.ok(pzFlow)
assert.equal(pzFlow!.quantity, 4 + 6 + 11 - 1)

// DDT unici nel periodo (non 2 conteggi per 2 righe)
assert.equal(report.ddtCount, 1)
assert.equal(report.ddtInPeriod[0]?.documentNumber, '798VEND')

// Consultativo: la funzione non muta gli input
assert.equal(articles.length, 4)
assert.equal(movements.length, 5)
assert.equal(movements[0]?.quantity, 4)

console.log('REPORT_CHECKS_OK')
