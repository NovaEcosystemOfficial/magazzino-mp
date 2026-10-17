import type { BrandId } from '../brands/brands'

export type CloudWarehouseReadErrorCode =
  | 'permission-denied'
  | 'unauthenticated'
  | 'not-found'
  | 'unavailable'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'unknown'

/**
 * Errore tipizzato per letture magazzino cloud (sola lettura).
 * Le rules pubblicate attuali negano brands/** → tipicamente `permission-denied`.
 */
export class CloudWarehouseReadError extends Error {
  readonly code: CloudWarehouseReadErrorCode
  readonly brandId?: BrandId
  readonly path?: string
  readonly cause?: unknown

  constructor(
    code: CloudWarehouseReadErrorCode,
    message: string,
    options?: { brandId?: BrandId; path?: string; cause?: unknown },
  ) {
    super(message)
    this.name = 'CloudWarehouseReadError'
    this.code = code
    this.brandId = options?.brandId
    this.path = options?.path
    this.cause = options?.cause
  }
}

function firebaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function mapFirestoreReadError(
  error: unknown,
  context: { brandId: BrandId; path: string },
): CloudWarehouseReadError {
  if (error instanceof CloudWarehouseReadError) {
    return error
  }

  const raw = firebaseErrorCode(error) ?? ''
  const normalized = raw.replace(/^firestore\//, '')

  if (normalized === 'permission-denied') {
    return new CloudWarehouseReadError(
      'permission-denied',
      `Lettura Firestore negata su ${context.path}. Le regole pubblicate chiudono brands/** (fase login).`,
      { ...context, cause: error },
    )
  }
  if (normalized === 'unauthenticated') {
    return new CloudWarehouseReadError(
      'unauthenticated',
      `Lettura Firestore richiede autenticazione (${context.path}).`,
      { ...context, cause: error },
    )
  }
  if (normalized === 'not-found') {
    return new CloudWarehouseReadError(
      'not-found',
      `Documento o database non trovato (${context.path}).`,
      { ...context, cause: error },
    )
  }
  if (normalized === 'unavailable') {
    return new CloudWarehouseReadError(
      'unavailable',
      `Firestore non raggiungibile (${context.path}).`,
      { ...context, cause: error },
    )
  }
  if (normalized === 'invalid-argument') {
    return new CloudWarehouseReadError(
      'invalid-argument',
      `Argomento non valido per la lettura (${context.path}).`,
      { ...context, cause: error },
    )
  }
  if (normalized === 'failed-precondition') {
    return new CloudWarehouseReadError(
      'failed-precondition',
      `Precondizione fallita per la lettura (${context.path}).`,
      { ...context, cause: error },
    )
  }

  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Errore sconosciuto'
  return new CloudWarehouseReadError(
    'unknown',
    `Lettura Firestore non riuscita (${context.path}): ${detail}`,
    { ...context, cause: error },
  )
}

/** True se l’errore indica deny dalle Security Rules (caso atteso con rules fase login). */
export function isPermissionDeniedReadError(error: unknown): boolean {
  if (error instanceof CloudWarehouseReadError) {
    return error.code === 'permission-denied'
  }
  const code = firebaseErrorCode(error) ?? ''
  return code === 'permission-denied' || code === 'firestore/permission-denied'
}
