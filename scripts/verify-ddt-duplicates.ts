import assert from 'node:assert/strict'
import {
  buildDdtDocumentFingerprint,
  findMovementsForDdtDocument,
  formatDdtAlreadyRegisteredMessage,
  movementMatchesDdtDocument,
} from '../src/ddt/ddtDocumentIdentity.ts'
import { buildDdtRowIdempotencyKey } from '../src/ddt/registerDdtCarichi.ts'
import type { StockMovement } from '../src/types/movements.ts'

function movement(partial: Partial<StockMovement> & Pick<StockMovement, 'documentRef' | 'supplier' | 'movementDate'>): StockMovement {
  return {
    id: partial.id ?? 'm1',
    type: 'CARICO',
    articleId: partial.articleId ?? 'mr108-oro',
    articleCode: partial.articleCode ?? 'MR108-ORO',
    quantity: partial.quantity ?? 6,
    movementDate: partial.movementDate,
    registeredAt: partial.registeredAt ?? '2026-10-02T10:00:00.000Z',
    supplier: partial.supplier,
    reason: partial.reason ?? '',
    documentRef: partial.documentRef,
    notes: partial.notes ?? '',
    idempotencyKey: partial.idempotencyKey ?? 'legacy-key',
  }
}

const ddt798: Parameters<typeof findMovementsForDdtDocument>[1] = {
  documentNumber: '798VEND',
  supplier: 'LES BIJOUX S.R.L.',
  documentDateIso: '2026-10-02',
}

const existing = [
  movement({
    id: 'a',
    documentRef: '798VEND',
    supplier: 'LES BIJOUX S.R.L.',
    movementDate: '2026-10-02',
    articleCode: 'MR108-ORO',
    quantity: 6,
  }),
  movement({
    id: 'b',
    documentRef: '798VEND',
    supplier: 'LES BIJOUX S.R.L.',
    movementDate: '2026-10-02',
    articleCode: 'MR108-GUN',
    quantity: 11,
  }),
]

// 1) Stesso DDT (numero+fornitore+data) riconosciuto anche con casing/spazi diversi
assert.equal(
  buildDdtDocumentFingerprint(ddt798),
  buildDdtDocumentFingerprint({
    documentNumber: ' 798vend ',
    supplier: 'les bijoux  s.r.l.',
    documentDateIso: '2026-10-02',
  }),
)

const matches = findMovementsForDdtDocument(existing, {
  documentNumber: '798vend',
  supplier: 'LES BIJOUX S.R.L.',
  documentDateIso: '2026-10-02',
})
assert.equal(matches.length, 2)

const message = formatDdtAlreadyRegisteredMessage(ddt798, matches.length)
assert.match(message, /già registrato/i)
assert.match(message, /798VEND/)
assert.match(message, /Nessuna nuova registrazione/i)

// 2) DDT diverso con articoli simili NON è duplicato
const otherDoc = movement({
  id: 'c',
  documentRef: '799VEND',
  supplier: 'LES BIJOUX S.R.L.',
  movementDate: '2026-10-02',
  articleCode: 'MR108-ORO',
  quantity: 6,
})
assert.equal(movementMatchesDdtDocument(otherDoc, ddt798), false)
assert.equal(findMovementsForDdtDocument([...existing, otherDoc], ddt798).length, 2)
assert.equal(
  findMovementsForDdtDocument([...existing, otherDoc], {
    documentNumber: '799VEND',
    supplier: 'LES BIJOUX S.R.L.',
    documentDateIso: '2026-10-02',
  }).length,
  1,
)

// 3) Stesso numero/data ma fornitore diverso → non blocca
assert.equal(
  findMovementsForDdtDocument(existing, {
    documentNumber: '798VEND',
    supplier: 'ALTRO FORNITORE SRL',
    documentDateIso: '2026-10-02',
  }).length,
  0,
)

// 4) Chiavi riga stabili: indipendenti da OCR/fileName; diverse per documenti diversi
const keyA = buildDdtRowIdempotencyKey({
  documentNumber: '798VEND',
  supplier: 'LES BIJOUX S.R.L.',
  documentDateIso: '2026-10-02',
  lineNumber: 1,
  articleCode: 'MR108-ORO',
  quantity: 6,
})
const keyAAgain = buildDdtRowIdempotencyKey({
  documentNumber: '798vend',
  supplier: 'les bijoux s.r.l.',
  documentDateIso: '2026-10-02',
  lineNumber: 1,
  articleCode: 'mr108-oro',
  quantity: 6,
})
const keyOtherDoc = buildDdtRowIdempotencyKey({
  documentNumber: '799VEND',
  supplier: 'LES BIJOUX S.R.L.',
  documentDateIso: '2026-10-02',
  lineNumber: 1,
  articleCode: 'MR108-ORO',
  quantity: 6,
})
assert.equal(keyA, keyAAgain)
assert.notEqual(keyA, keyOtherDoc)
assert.ok(!keyA.includes('marina'))
assert.ok(!keyA.includes('art. mr108'))

console.log('DDT_DUPLICATE_CHECKS_OK')
