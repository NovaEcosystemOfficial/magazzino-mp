export type DdtExtractionSource = 'text' | 'ocr' | 'mixed'

export type DdtTextItem = {
  str: string
  x: number
  y: number
  width: number
  height: number
}

export type DdtHeaderFields = {
  documentNumber: string
  documentDate: string
  documentDateIso: string
  supplier: string
}

export type DdtExtractedLine = {
  /** Identificatore stabile della riga nell’estrazione corrente. */
  id: string
  lineNumber: number
  rawText: string
  articleCodeCandidate: string
  description: string
  unitOfMeasure: string
  quantityRaw: string
  quantity: number | null
  confidence: 'high' | 'medium' | 'low'
  warnings: string[]
}

export type DdtExtractionResult = {
  fileName: string
  pageCount: number
  source: DdtExtractionSource
  rawText: string
  header: DdtHeaderFields
  lines: DdtExtractedLine[]
  warnings: string[]
}

export type DdtMatchStatus = 'matched' | 'da_verificare' | 'excluded'

export type DdtEditableRow = {
  id: string
  included: boolean
  lineNumber: number
  rawText: string
  articleCodeCandidate: string
  description: string
  unitOfMeasure: string
  quantityRaw: string
  quantity: number | null
  matchedArticleCode: string | null
  matchedArticleDescription: string | null
  matchStatus: DdtMatchStatus
  extractionConfidence: 'high' | 'medium' | 'low'
  warnings: string[]
  manualNotes: string
}

export type DdtImportSummary = {
  fileName: string
  documentNumber: string
  documentDateIso: string
  supplier: string
  registered: number
  skippedAlreadyApplied: number
  excluded: number
  messages: string[]
  /** True se il documento intero era già in storico (nessun nuovo carico). */
  alreadyRegisteredDocument: boolean
}
