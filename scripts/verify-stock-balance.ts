import assert from 'node:assert/strict'
import type { StockMovement } from '../src/types/movements.ts'
import {
  buildArticleStockBalance,
  computeCurrentStock,
  reconcileArticlesWithMovements,
  summarizeMovements,
} from '../src/utils/stockBalance.ts'
import { stockCoversQuantity } from '../src/utils/quantity.ts'
import type { ArticleRecord } from '../src/types/articles.ts'

function movement(
  type: 'CARICO' | 'SCARICO',
  quantity: number,
  id: string,
): StockMovement {
  return {
    id,
    type,
    articleId: 'test-1',
    articleCode: 'TEST-1',
    quantity,
    movementDate: '2026-10-13',
    registeredAt: '2026-10-13T10:00:00.000Z',
    supplier: type === 'CARICO' ? 'Fornitore' : '',
    reason: type === 'SCARICO' ? 'Prelievo interno' : '',
    documentRef: `DOC-${id}`,
    notes: '',
    idempotencyKey: `key-${id}`,
  }
}

const initial = '100'

// Dopo i carichi: +20 +10 → 130
const afterCarichi = [movement('CARICO', 20, 'c1'), movement('CARICO', 10, 'c2')]
assert.equal(computeCurrentStock(initial, afterCarichi), '130')
assert.deepEqual(summarizeMovements(afterCarichi), { totalIn: 30, totalOut: 0 })

// Dopo il primo scarico: −15 → 115
const afterFirstScarico = [...afterCarichi, movement('SCARICO', 15, 's1')]
assert.equal(computeCurrentStock(initial, afterFirstScarico), '115')

// Dopo il secondo scarico: −25 → 90
const afterSecondScarico = [...afterFirstScarico, movement('SCARICO', 25, 's2')]
const balance = buildArticleStockBalance(initial, afterSecondScarico)
assert.equal(balance.totalIn, 30)
assert.equal(balance.totalOut, 40)
assert.equal(balance.currentStock, '90')
assert.equal(balance.totalInLabel, '30')
assert.equal(balance.totalOutLabel, '40')

// Scarico superiore alla disponibilità deve essere rifiutato (senza overdraft)
assert.equal(stockCoversQuantity(balance.currentStock, 91), false)
assert.equal(stockCoversQuantity(balance.currentStock, 90), true)
assert.equal(stockCoversQuantity('115', 25), true)
assert.equal(stockCoversQuantity('115', 116), false)

// Reconcile allinea currentStock driftato alla formula senza toccare i movimenti
const driftedArticle: ArticleRecord = {
  code: 'TEST-1',
  description: 'Articolo prova',
  unitOfMeasure: 'pz',
  stock: '100',
  currentStock: '100', // drift: non riflette i movimenti
  status: 'attivo',
  category: '—',
  supplier: '—',
  minStock: '—',
  totalReceived: '999', // storico Excel, non deve entrare nel calcolo
  sourceFields: {},
}

const reconciled = reconcileArticlesWithMovements([driftedArticle], afterSecondScarico)
assert.equal(reconciled[0]?.currentStock, '90')
assert.equal(reconciled[0]?.stock, '100')
assert.equal(reconciled[0]?.totalReceived, '999')
assert.equal(afterSecondScarico.length, 4)

console.log('STOCK_BALANCE_CHECKS_OK')
