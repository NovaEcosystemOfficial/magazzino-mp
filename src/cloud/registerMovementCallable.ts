/**
 * Client per Callable opzionali (Blaze, europe-west1).
 *
 * Attivo solo con VITE_USE_STOCK_CALLABLE=true.
 * Percorso default Spark: warehouseRepository → registerCloud* (niente Callable).
 */

import { httpsCallable, getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import type { BrandId } from '../brands/brands'
import { getFirebaseApp } from '../firebase/app'
import type { CaricoInput, ScaricoInput, StockMovement } from '../types/movements'
import type { RegisterMovementResult } from '../storage/movementsDb'
import { normalizeStockMovement } from '../types/movements'

export function isStockCallableRequested(): boolean {
  const raw =
    typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_USE_STOCK_CALLABLE
      : undefined
  return String(raw ?? '').trim().toLowerCase() === 'true'
}

let functionsConnected = false

function getCallableFunctions() {
  const functions = getFunctions(getFirebaseApp(), 'europe-west1')
  if (
    !functionsConnected &&
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_FUNCTIONS_EMULATOR === 'true'
  ) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    functionsConnected = true
  }
  return functions
}

type CallableMovement = {
  id: string
  type: 'CARICO' | 'SCARICO'
  articleId: string
  articleCode: string
  quantity: number
  movementDate: string
  registeredAt: string
  supplier: string
  reason: string
  documentRef: string
  notes: string
  idempotencyKey: string
  performedByUid?: string
  performedByUsername?: string
}

type CallableResponse = {
  alreadyApplied: boolean
  movementId: string
  previousStock: string
  newStock: string
  movement: CallableMovement
}

function mapCallableError(error: unknown): Error {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: string }).code)
    const message = String((error as { message?: string }).message ?? '')
    if (code === 'functions/not-found' || code === 'functions/unavailable') {
      return new Error(
        'Callable registerWarehouseMovement non disponibile. Serve deploy Blaze della Function e VITE_USE_STOCK_CALLABLE=true.',
      )
    }
    if (code === 'functions/failed-precondition') {
      return new Error(message.replace(/^Firebase:\s*/i, '') || 'Giacenza insufficiente.')
    }
    if (code === 'functions/permission-denied') {
      return new Error('Operazione non autorizzata (profilo o ruolo).')
    }
    if (code === 'functions/unauthenticated') {
      return new Error('Autenticazione obbligatoria per registrare movimenti cloud.')
    }
    if (message) {
      return new Error(message.replace(/^Firebase:\s*/i, ''))
    }
  }
  if (error instanceof Error) return error
  return new Error('Registrazione movimento cloud non riuscita.')
}

async function invokeRegister(
  brandId: BrandId,
  type: 'CARICO' | 'SCARICO',
  input: CaricoInput | ScaricoInput,
): Promise<RegisterMovementResult> {
  if (!isStockCallableRequested()) {
    throw new Error(
      'Registrazione cloud richiede VITE_USE_STOCK_CALLABLE=true (percorso backend obbligatorio).',
    )
  }

  try {
    const callable = httpsCallable(getCallableFunctions(), 'registerWarehouseMovement')
    const payload =
      type === 'CARICO'
        ? {
            brandId,
            type,
            articleCode: (input as CaricoInput).articleCode,
            quantity: input.quantity,
            movementDate: input.movementDate,
            supplier: (input as CaricoInput).supplier,
            documentRef: input.documentRef,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
          }
        : {
            brandId,
            type,
            articleCode: (input as ScaricoInput).articleCode,
            quantity: input.quantity,
            movementDate: input.movementDate,
            reason: (input as ScaricoInput).reason,
            documentRef: input.documentRef,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
            // allowOverdraft ignorato dal server: scarichi sotto zero sempre rifiutati
          }

    const result = await callable(payload)
    const data = result.data as CallableResponse
    if (!data?.movement) {
      throw new Error('Risposta Callable incompleta (movimento assente).')
    }

    const movement: StockMovement = normalizeStockMovement({
      ...data.movement,
      performedByUid: data.movement.performedByUid,
      performedByUsername: data.movement.performedByUsername,
    })

    return {
      movement,
      previousStock: data.previousStock,
      newStock: data.newStock,
      alreadyApplied: data.alreadyApplied === true,
    }
  } catch (error) {
    throw mapCallableError(error)
  }
}

export async function registerCaricoViaCallable(
  input: CaricoInput,
  brandId: BrandId,
): Promise<RegisterMovementResult> {
  return invokeRegister(brandId, 'CARICO', input)
}

export async function registerScaricoViaCallable(
  input: ScaricoInput,
  brandId: BrandId,
): Promise<RegisterMovementResult> {
  return invokeRegister(brandId, 'SCARICO', input)
}

/** Import snapshot brand via Callable admin (migrazione). */
export async function importBrandSnapshotViaCallable(
  brandId: BrandId,
  articles: unknown[],
  movements: unknown[],
): Promise<{
  brandId: string
  writtenArticles: number
  skippedArticles: number
  writtenMovements: number
  skippedMovements: number
}> {
  if (!isStockCallableRequested()) {
    throw new Error(
      'Migrazione cloud richiede VITE_USE_STOCK_CALLABLE=true e Function importBrandSnapshot deployata.',
    )
  }
  try {
    const callable = httpsCallable(getCallableFunctions(), 'importBrandSnapshot')
    const result = await callable({ brandId, articles, movements })
    return result.data as {
      brandId: string
      writtenArticles: number
      skippedArticles: number
      writtenMovements: number
      skippedMovements: number
    }
  } catch (error) {
    throw mapCallableError(error)
  }
}
