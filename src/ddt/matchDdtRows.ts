import type { ArticleRecord } from '../types/articles'
import type { DdtEditableRow, DdtExtractedLine, DdtMatchStatus } from '../types/ddt'

function normalizeCode(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Associa un articolo solo con certezza sufficiente (match esatto del codice).
 * Non inventa codici e non associa solo per similitudine di descrizione.
 */
export function matchExtractedLinesToArticles(
  lines: DdtExtractedLine[],
  articles: ArticleRecord[],
): DdtEditableRow[] {
  const byCode = new Map<string, ArticleRecord>()
  for (const article of articles) {
    byCode.set(normalizeCode(article.code), article)
  }

  return lines.map((line) => {
    const candidate = line.articleCodeCandidate.trim()
    const exact = candidate ? byCode.get(normalizeCode(candidate)) : undefined
    const warnings = [...line.warnings]

    let matchStatus: DdtMatchStatus = 'da_verificare'
    let matchedArticleCode: string | null = null
    let matchedArticleDescription: string | null = null

    if (exact) {
      matchStatus = 'matched'
      matchedArticleCode = exact.code
      matchedArticleDescription = exact.description
    } else if (candidate) {
      warnings.push(`Codice “${candidate}” non presente in anagrafica.`)
    } else {
      warnings.push('Da verificare: selezionare manualmente l’articolo dall’anagrafica.')
    }

    if (line.quantity === null) {
      warnings.push('Quantità da completare prima della registrazione.')
    }

    if (line.confidence === 'low') {
      warnings.push('Risultato di estrazione incerto.')
    }

    return {
      id: line.id,
      included: true,
      lineNumber: line.lineNumber,
      rawText: line.rawText,
      articleCodeCandidate: candidate,
      description: line.description,
      unitOfMeasure: line.unitOfMeasure,
      quantityRaw: line.quantityRaw,
      quantity: line.quantity,
      matchedArticleCode,
      matchedArticleDescription,
      matchStatus,
      extractionConfidence: line.confidence,
      warnings: [...new Set(warnings)],
      manualNotes: '',
    }
  })
}

export function applyManualArticleSelection(
  row: DdtEditableRow,
  article: ArticleRecord | null,
): DdtEditableRow {
  if (!article) {
    return {
      ...row,
      matchedArticleCode: null,
      matchedArticleDescription: null,
      matchStatus: row.included ? 'da_verificare' : 'excluded',
    }
  }

  return {
    ...row,
    matchedArticleCode: article.code,
    matchedArticleDescription: article.description,
    matchStatus: row.included ? 'matched' : 'excluded',
    warnings: row.warnings.filter(
      (warning) =>
        !/non presente in anagrafica/i.test(warning) &&
        !/selezionare manualmente/i.test(warning) &&
        !/Da verificare/i.test(warning),
    ),
  }
}
