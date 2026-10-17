/**
 * Test Fase 2B su Firebase Emulator (Firestore locale).
 * Non tocca produzione / rules pubblicate / IndexedDB.
 *
 * Prerequisito: emulatore in esecuzione (via `firebase emulators:exec`)
 * e JAVA_HOME impostato.
 *
 * Esempio:
 *   $env:JAVA_HOME="…\\jdk-21.0.12.101-hotspot"
 *   $env:Path="$env:JAVA_HOME\\bin;$env:Path"
 *   npx -y firebase-tools@latest emulators:exec --only firestore --project demo-magazzino-mp "npx tsx scripts/verify-fase-2b-emulator-read.ts"
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, type Firestore } from 'firebase/firestore'
import {
  CloudWarehouseReadError,
  isPermissionDeniedReadError,
} from '../src/cloud/firestoreReadErrors.ts'
import {
  getCloudArticle,
  getCloudMovement,
  listCloudArticles,
  listCloudMovements,
} from '../src/cloud/warehouseRead.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'demo-magazzino-mp'
const RULES = readFileSync(join(root, 'emulator/firestore.rules'), 'utf8')

assert.match(RULES, /SOLO Firebase Emulator Suite/)
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /127\.0\.0\.1|localhost/)

function sampleArticle(code: string) {
  const codeKey = code.toLowerCase()
  return {
    code,
    codeKey,
    description: `Articolo ${code}`,
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

function sampleMovement(id: string, articleCode: string, uid: string) {
  return {
    id,
    type: 'CARICO' as const,
    articleId: articleCode.toLowerCase(),
    articleCode,
    quantity: 2,
    movementDate: '2026-10-17',
    registeredAt: '2026-10-17T08:00:00.000Z',
    supplier: 'Fornitore',
    reason: '',
    documentRef: 'DOC-1',
    notes: '',
    idempotencyKey: id,
    performedByUid: uid,
    performedByUsername: 'operatore',
  }
}

async function seed(testEnv: RulesTestEnvironment): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', 'uid-operator'), {
      username: 'operatore',
      displayName: 'Operatore',
      role: 'operator',
      active: true,
    })
    await setDoc(doc(db, 'users', 'uid-inactive'), {
      username: 'disattivo',
      displayName: 'Disattivo',
      role: 'operator',
      active: false,
    })
    await setDoc(
      doc(db, 'brands', 'marina-raphael', 'articles', 'mr-1'),
      sampleArticle('MR-1'),
    )
    await setDoc(
      doc(db, 'brands', 'elie-saab', 'movements', 'es-m1'),
      sampleMovement('es-m1', 'ES-1', 'uid-operator'),
    )
    await setDoc(
      doc(db, 'brands', 'swarovski', 'articles', 'sw-1'),
      sampleArticle('SW-1'),
    )
  })
}

function dbFor(testEnv: RulesTestEnvironment, uid: string | null): Firestore {
  if (uid === null) {
    return testEnv.unauthenticatedContext().firestore()
  }
  return testEnv.authenticatedContext(uid).firestore()
}

async function main(): Promise<void> {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: RULES,
      host: '127.0.0.1',
      port: 8080,
    },
  })

  try {
    await testEnv.clearFirestore()
    await seed(testEnv)

    const opDb = dbFor(testEnv, 'uid-operator')

    // ——— Letture autorizzate (operator attivo) ———
    const mrArticles = await assertSucceeds(
      listCloudArticles('marina-raphael', { db: opDb }),
    )
    assert.equal(mrArticles.length, 1)
    assert.equal(mrArticles[0]?.code, 'MR-1')

    const one = await assertSucceeds(
      getCloudArticle('marina-raphael', 'mr-1', { db: opDb }),
    )
    assert.equal(one?.codeKey, 'mr-1')

    const esMovements = await assertSucceeds(
      listCloudMovements('elie-saab', { db: opDb }),
    )
    assert.equal(esMovements.length, 1)
    assert.equal(esMovements[0]?.id, 'es-m1')

    const swArticles = await assertSucceeds(
      listCloudArticles('swarovski', { db: opDb }),
    )
    assert.equal(swArticles.length, 1)

    // Isolamento path: MR non contiene i movimenti ES
    const mrMovements = await assertSucceeds(
      listCloudMovements('marina-raphael', { db: opDb }),
    )
    assert.equal(mrMovements.length, 0)

    const missing = await assertSucceeds(
      getCloudMovement('elie-saab', 'missing', { db: opDb }),
    )
    assert.equal(missing, null)

    // ——— Letture negate ———
    const unauthDb = dbFor(testEnv, null)
    await assertFails(listCloudArticles('marina-raphael', { db: unauthDb }))
    try {
      await listCloudArticles('marina-raphael', { db: unauthDb })
      assert.fail('atteso permission-denied per utente non autenticato')
    } catch (error) {
      assert.ok(error instanceof CloudWarehouseReadError)
      assert.equal(error.code, 'permission-denied')
      assert.ok(isPermissionDeniedReadError(error))
    }

    const inactiveDb = dbFor(testEnv, 'uid-inactive')
    try {
      await listCloudMovements('elie-saab', { db: inactiveDb })
      assert.fail('atteso permission-denied per operatore disattivo')
    } catch (error) {
      assert.ok(error instanceof CloudWarehouseReadError)
      assert.equal(error.code, 'permission-denied')
    }

    // Update movimento deve fallire anche per operator (immutabilità)
    const { updateDoc, doc: fsDoc } = await import('firebase/firestore')
    await assertFails(
      updateDoc(fsDoc(opDb, 'brands', 'elie-saab', 'movements', 'es-m1'), {
        notes: 'hack',
      }),
    )

    console.log('FASE_2B_EMULATOR_READ_CHECKS_OK')
    console.log(
      `FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? ''}`,
    )
  } finally {
    await testEnv.cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
