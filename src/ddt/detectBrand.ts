import { type BrandId } from '../brands/brands'

export type BrandDetectionResult = {
  /** Brand proposto dal testo documento; null se non riconoscibile. */
  suggestedBrandId: BrandId | null
  confidence: 'high' | 'medium' | 'none'
  evidence: string
  /** True se nel testo compare un fornitore tipico senza brand chiaro. */
  supplierOnlyHint: string | null
}

/**
 * Propone un brand dal testo DDT. Non confonde il fornitore con il brand:
 * es. "LES BIJOUX" → hint fornitore, non brand.
 */
export function detectBrandFromDocumentText(text: string): BrandDetectionResult {
  const compact = text.replace(/\s+/g, ' ').trim()
  const upper = compact.toUpperCase()

  if (/ELIE\s*SAAB/.test(upper)) {
    return {
      suggestedBrandId: 'elie-saab',
      confidence: 'high',
      evidence: 'ELIE SAAB',
      supplierOnlyHint: null,
    }
  }

  if (/SWAROVSKI/.test(upper)) {
    return {
      suggestedBrandId: 'swarovski',
      confidence: 'high',
      evidence: 'Swarovski',
      supplierOnlyHint: null,
    }
  }

  if (/MARINA\s*RAPHAEL/.test(upper) || /\bM\.?\s*RAPHAEL\b/.test(upper)) {
    return {
      suggestedBrandId: 'marina-raphael',
      confidence: 'high',
      evidence: 'Marina Raphael',
      supplierOnlyHint: null,
    }
  }

  let supplierOnlyHint: string | null = null
  if (/LES\s+BIJOUX/.test(upper)) {
    supplierOnlyHint = 'LES BIJOUX (fornitore, non brand)'
  }

  return {
    suggestedBrandId: null,
    confidence: 'none',
    evidence: '',
    supplierOnlyHint,
  }
}
