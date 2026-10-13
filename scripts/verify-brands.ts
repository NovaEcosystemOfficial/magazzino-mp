import assert from 'node:assert/strict'
import {
  BRAND_DEFINITIONS,
  BRAND_IDS,
  DEFAULT_BRAND_ID,
  getBrandDefinition,
  isBrandId,
} from '../src/brands/brands.ts'
import { detectBrandFromDocumentText } from '../src/ddt/detectBrand.ts'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_VERSION_LEGACY,
  BACKUP_VERSION_V2,
  validateBackupPayload,
} from '../src/storage/backup.ts'

assert.equal(DEFAULT_BRAND_ID, 'marina-raphael')
assert.equal(getBrandDefinition('marina-raphael').dbName, 'magazzino-mr')
assert.equal(getBrandDefinition('elie-saab').dbName, 'magazzino-mp-elie-saab')
assert.equal(getBrandDefinition('swarovski').dbName, 'magazzino-mp-swarovski')
assert.ok(isBrandId('marina-raphael'))
assert.equal(isBrandId('altro'), false)
assert.equal(BRAND_DEFINITIONS.length, 3)
assert.deepEqual([...BRAND_IDS], ['marina-raphael', 'elie-saab', 'swarovski'])

// Brand detection: non confonde fornitore e brand
const supplierOnly = detectBrandFromDocumentText('Fornitore LES BIJOUX S.R.L. DDT n. 12')
assert.equal(supplierOnly.suggestedBrandId, null)
assert.ok(supplierOnly.supplierOnlyHint)

const elie = detectBrandFromDocumentText('Destinazione ELIE SAAB — colli 2')
assert.equal(elie.suggestedBrandId, 'elie-saab')
assert.equal(elie.confidence, 'high')

const sw = detectBrandFromDocumentText('Merce SWAROVSKI per showroom')
assert.equal(sw.suggestedBrandId, 'swarovski')

const mr = detectBrandFromDocumentText('Cliente MARINA RAPHAEL Milano')
assert.equal(mr.suggestedBrandId, 'marina-raphael')

const sampleArticle = {
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
}

// Backup v2 legacy ancora valido
const v2 = validateBackupPayload({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION_V2,
  exportedAt: '2026-10-13T00:00:00.000Z',
  meta: { articleCount: 1, movementCount: 0, source: 'indexeddb-local' },
  articles: [sampleArticle],
  movements: [],
})
assert.equal(v2.version, BACKUP_VERSION_V2)
assert.equal(v2.archives?.['marina-raphael']?.articles.length, 1)
assert.deepEqual(v2.meta.brands, ['marina-raphael'])

// Backup v1
const v1 = validateBackupPayload({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION_LEGACY,
  exportedAt: '2026-10-13T00:00:00.000Z',
  meta: { articleCount: 1, source: 'indexeddb-local' },
  articles: [sampleArticle],
})
assert.equal(v1.movements.length, 0)

// Backup v3 multi-brand
const v3 = validateBackupPayload({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2026-10-13T00:00:00.000Z',
  meta: { articleCount: 1, movementCount: 0, source: 'indexeddb-local' },
  articles: [sampleArticle],
  movements: [],
  archives: {
    'marina-raphael': { articles: [sampleArticle], movements: [] },
    'elie-saab': { articles: [], movements: [] },
    swarovski: { articles: [], movements: [] },
  },
})
assert.equal(v3.version, 3)
assert.equal(v3.meta.articleCount, 1)
assert.equal(v3.archives?.['elie-saab']?.articles.length, 0)

console.log('BRANDS_CHECKS_OK')
