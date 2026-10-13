import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BRAND_DEFINITIONS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  getBrandDefinition,
} from '../src/brands/brands.ts'
import { detectBrandFromDocumentText } from '../src/ddt/detectBrand.ts'
import {
  findMovementsForDdtDocument,
  formatDdtAlreadyRegisteredMessage,
} from '../src/ddt/ddtDocumentIdentity.ts'
import { matchExtractedLinesToArticles } from '../src/ddt/matchDdtRows.ts'
import { getRegistrableRows } from '../src/ddt/registerDdtCarichi.ts'
import { DB_VERSION, LEGACY_MR_DB_NAME } from '../src/storage/db.ts'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_VERSION_LEGACY,
  BACKUP_VERSION_V2,
  getRestoreScope,
  validateBackupPayload,
} from '../src/storage/backup.ts'
import type { ArticleRecord } from '../src/types/articles.ts'
import type { DdtExtractedLine } from '../src/types/ddt.ts'
import type { StockMovement } from '../src/types/movements.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function sampleArticle(code: string, description: string): ArticleRecord {
  return {
    code,
    description,
    unitOfMeasure: 'pz',
    stock: '10',
    currentStock: '10',
    status: 'attivo',
    category: '—',
    supplier: '—',
    minStock: '—',
    totalReceived: '—',
    sourceFields: {},
  }
}

function sampleMovement(partial: Partial<StockMovement> & Pick<StockMovement, 'documentRef' | 'supplier' | 'movementDate' | 'articleCode'>): StockMovement {
  return {
    id: partial.id ?? `m-${partial.articleCode}`,
    type: 'CARICO',
    articleId: (partial.articleId ?? partial.articleCode).toLowerCase(),
    articleCode: partial.articleCode,
    quantity: partial.quantity ?? 1,
    movementDate: partial.movementDate,
    registeredAt: partial.registeredAt ?? '2026-10-13T10:00:00.000Z',
    supplier: partial.supplier,
    reason: '',
    documentRef: partial.documentRef,
    notes: '',
    idempotencyKey: partial.idempotencyKey ?? `key-${partial.articleCode}`,
  }
}

// ——— 1) Isolamento database / MR non migrato automaticamente ———
assert.equal(LEGACY_MR_DB_NAME, 'magazzino-mr')
assert.equal(getBrandDefinition('marina-raphael').dbName, 'magazzino-mr')
assert.equal(getBrandDefinition('elie-saab').dbName, 'magazzino-mp-elie-saab')
assert.equal(getBrandDefinition('swarovski').dbName, 'magazzino-mp-swarovski')
assert.equal(DB_VERSION, 2)
assert.equal(DEFAULT_BRAND_ID, 'marina-raphael')

const dbNames = new Set(BRAND_DEFINITIONS.map((b) => b.dbName))
assert.equal(dbNames.size, 3, 'Ogni brand deve avere un DB IndexedDB distinto')

const srcFiles = [
  'src/storage/db.ts',
  'src/storage/articlesDb.ts',
  'src/storage/movementsDb.ts',
  'src/storage/backup.ts',
  'src/App.tsx',
  'src/brands/brands.ts',
]
for (const relative of srcFiles) {
  const content = readFileSync(join(root, relative), 'utf8')
  assert.equal(
    content.includes('deleteDatabase'),
    false,
    `${relative} non deve cancellare IndexedDB`,
  )
}

// ——— 2) Backup V1/V2: scope solo Marina Raphael ———
const articleMr = sampleArticle('MR-1', 'Articolo MR')
const v2 = validateBackupPayload({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION_V2,
  exportedAt: '2026-10-13T00:00:00.000Z',
  meta: { articleCount: 1, movementCount: 0, source: 'indexeddb-local' },
  articles: [articleMr],
  movements: [],
})
const scopeV2 = getRestoreScope(v2)
assert.deepEqual(scopeV2.brandsToReplace, ['marina-raphael'])
assert.equal(scopeV2.marinaRaphaelOnly, true)
assert.match(scopeV2.overwriteWarning, /solo Marina Raphael/i)
assert.match(scopeV2.overwriteWarning, /ELIE SAAB e Swarovski restano intatti/i)
assert.ok(!scopeV2.brandsToReplace.includes('elie-saab'))
assert.ok(!scopeV2.brandsToReplace.includes('swarovski'))

const v1 = validateBackupPayload({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION_LEGACY,
  exportedAt: '2026-10-13T00:00:00.000Z',
  meta: { articleCount: 1, source: 'indexeddb-local' },
  articles: [articleMr],
})
const scopeV1 = getRestoreScope(v1)
assert.deepEqual(scopeV1.brandsToReplace, ['marina-raphael'])
assert.equal(scopeV1.marinaRaphaelOnly, true)

// ——— 3) Backup V3: tre archivi + warning overwrite completo ———
const articleEs = sampleArticle('ES-1', 'Articolo ELIE')
const articleSw = sampleArticle('SW-1', 'Articolo SW')
const v3 = validateBackupPayload({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2026-10-13T12:00:00.000Z',
  meta: { articleCount: 3, movementCount: 0, source: 'indexeddb-local' },
  articles: [articleMr],
  movements: [],
  archives: {
    'marina-raphael': { articles: [articleMr], movements: [] },
    'elie-saab': { articles: [articleEs], movements: [] },
    swarovski: { articles: [articleSw], movements: [] },
  },
})
assert.equal(v3.version, 3)
for (const brandId of BRAND_IDS) {
  assert.ok(v3.archives?.[brandId], `V3 deve contenere archives.${brandId}`)
}
assert.equal(v3.archives?.['marina-raphael']?.articles[0]?.code, 'MR-1')
assert.equal(v3.archives?.['elie-saab']?.articles[0]?.code, 'ES-1')
assert.equal(v3.archives?.swarovski?.articles[0]?.code, 'SW-1')

const scopeV3 = getRestoreScope(v3)
assert.deepEqual(scopeV3.brandsToReplace, [...BRAND_IDS])
assert.equal(scopeV3.marinaRaphaelOnly, false)
assert.match(scopeV3.overwriteWarning, /tutti e tre i brand/i)

// SettingsView usa getRestoreScope (verifica presenza nel sorgente)
const settingsSrc = readFileSync(join(root, 'src/components/SettingsView.tsx'), 'utf8')
assert.match(settingsSrc, /getRestoreScope/)
assert.match(settingsSrc, /Conferma per procedere/)
assert.match(settingsSrc, /pendingRestorePayload/)

// ——— 4) DDT: match solo sull’anagrafica del brand selezionato ———
const lineEs: DdtExtractedLine = {
  id: 'L1',
  lineNumber: 1,
  rawText: 'ES-1 collana 2',
  articleCodeCandidate: 'ES-1',
  description: 'collana',
  unitOfMeasure: 'pz',
  quantityRaw: '2',
  quantity: 2,
  confidence: 'high',
  warnings: [],
}

const matchedOnMr = matchExtractedLinesToArticles([lineEs], [articleMr])
assert.equal(matchedOnMr[0]?.matchStatus, 'da_verificare')
assert.equal(matchedOnMr[0]?.matchedArticleCode, null)

const matchedOnEs = matchExtractedLinesToArticles([lineEs], [articleEs])
assert.equal(matchedOnEs[0]?.matchStatus, 'matched')
assert.equal(matchedOnEs[0]?.matchedArticleCode, 'ES-1')

const { registrable: regMr, blocked: blockedMr } = getRegistrableRows(matchedOnMr)
assert.equal(regMr.length, 0)
assert.ok(blockedMr.length > 0)

const { registrable: regEs, blocked: blockedEs } = getRegistrableRows(matchedOnEs)
assert.equal(regEs.length, 1)
assert.equal(blockedEs.length, 0)

// Brand detection ≠ fornitore
const supplierOnly = detectBrandFromDocumentText('Fornitore LES BIJOUX S.R.L. DDT n. 100')
assert.equal(supplierOnly.suggestedBrandId, null)
assert.ok(supplierOnly.supplierOnlyHint)

const elieDoc = detectBrandFromDocumentText('Destinatario ELIE SAAB showroom')
assert.equal(elieDoc.suggestedBrandId, 'elie-saab')

// registerDdtCarichi richiede brandId nel tipo (controllo sorgente)
const registerSrc = readFileSync(join(root, 'src/ddt/registerDdtCarichi.ts'), 'utf8')
assert.match(registerSrc, /brandId: BrandId/)
assert.match(registerSrc, /findCarichiForDdtDocument\(identity, brandId\)/)
assert.match(registerSrc, /registerCarico\([\s\S]*brandId/)

// ——— 5) DDT duplicati: stesso documento → nessuna nuova registrazione ———
const identity = {
  documentNumber: '900ES',
  supplier: 'LES BIJOUX S.R.L.',
  documentDateIso: '2026-10-13',
}
const existingEs = [
  sampleMovement({
    documentRef: '900ES',
    supplier: 'LES BIJOUX S.R.L.',
    movementDate: '2026-10-13',
    articleCode: 'ES-1',
    quantity: 2,
  }),
]
const dupes = findMovementsForDdtDocument(existingEs, identity)
assert.equal(dupes.length, 1)
const dupeMessage = formatDdtAlreadyRegisteredMessage(identity, dupes.length)
assert.match(dupeMessage, /già registrato/i)
assert.match(dupeMessage, /Nessuna nuova registrazione/i)

// Stesso numero DDT in un altro brand (movimenti separati) non è lo stesso archivio:
// l’isolamento è per DB; qui verifichiamo che il gate documenti sia per lista movimenti passata.
const existingMrSameNumber = [
  sampleMovement({
    documentRef: '900ES',
    supplier: 'LES BIJOUX S.R.L.',
    movementDate: '2026-10-13',
    articleCode: 'MR-1',
    quantity: 5,
  }),
]
assert.equal(findMovementsForDdtDocument(existingMrSameNumber, identity).length, 1)
assert.equal(findMovementsForDdtDocument([], identity).length, 0)

console.log('MULTI_BRAND_SAFETY_CHECKS_OK')
