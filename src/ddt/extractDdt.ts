import type { DdtExtractionResult, DdtExtractionSource } from '../types/ddt'
import { extractTextItemsFromPdf } from './pdfExtract'
import { extractHeaderFields, parseDdtFromPlainText, parseDdtFromTextItems } from './parseDdt'

const MIN_USEFUL_TEXT_LENGTH = 60

function hasDocumentSignal(text: string): boolean {
  return /D\.?\s*d\.?\s*T\.?/i.test(text) || /\bn\.\s*\d+[A-Z]*\b/i.test(text)
}

export type ExtractDdtOptions = {
  fileName: string
  data: ArrayBuffer
  forceOcr?: boolean
  onProgress?: (info: { phase: string; detail?: string; progress?: number }) => void
}

/**
 * Estrae metadati e righe da un PDF DDT.
 * Non registra movimenti: solo lettura e interpretazione locale.
 */
export async function extractDdtFromPdf(options: ExtractDdtOptions): Promise<DdtExtractionResult> {
  const { fileName, data, forceOcr = false, onProgress } = options
  const warnings: string[] = []

  onProgress?.({ phase: 'Lettura PDF', detail: fileName, progress: 0.05 })

  let pageCount = 1
  let source: DdtExtractionSource = 'text'
  let plainText = ''
  let parsed = parseDdtFromPlainText('')

  try {
    const textExtract = await extractTextItemsFromPdf(data)
    pageCount = textExtract.pageCount
    onProgress?.({
      phase: 'Estrazione testo',
      detail: `${pageCount} pagina/e`,
      progress: 0.25,
    })

    const textParsed = parseDdtFromTextItems(textExtract.items)
    plainText = textParsed.plainText
    parsed = textParsed
    warnings.push(...textParsed.warnings)

    const usefulLength = textExtract.plainTextLength
    const needsOcr =
      forceOcr ||
      usefulLength < MIN_USEFUL_TEXT_LENGTH ||
      (!hasDocumentSignal(plainText) && textParsed.lines.length === 0)

    if (needsOcr) {
      source = usefulLength > 0 ? 'mixed' : 'ocr'
      onProgress?.({
        phase: 'OCR locale',
        detail: 'Elaborazione nel browser, senza invio del documento',
        progress: 0.35,
      })

      try {
        const { ocrPdfPages } = await import('./ocrPdf')
        const ocr = await ocrPdfPages(data, pageCount, (info) => {
          onProgress?.({
            phase: 'OCR locale',
            detail: info.status,
            progress: 0.35 + info.progress * 0.5,
          })
        })
        warnings.push(...ocr.warnings)
        if (ocr.text.trim()) {
          const ocrParsed = parseDdtFromPlainText(ocr.text)
          // Preferisci OCR se ha trovato più righe o il numero documento.
          const preferOcr =
            forceOcr ||
            ocrParsed.lines.length > parsed.lines.length ||
            (!parsed.header.documentNumber && !!ocrParsed.header.documentNumber)

          if (preferOcr) {
            plainText = ocr.text
            parsed = ocrParsed
            warnings.push('Risultato basato su OCR locale: verificare le righe evidenziate.')
            for (const line of parsed.lines) {
              if (line.confidence === 'high') {
                line.confidence = 'medium'
              }
              if (!line.warnings.some((w) => /OCR/i.test(w))) {
                line.warnings.push('Estrazione OCR: controllare codice e quantità.')
              }
            }
          } else {
            warnings.push(
              'OCR eseguito ma l’estrazione testuale è risultata più completa: usato il testo PDF.',
            )
          }
        }
      } catch (ocrError) {
        warnings.push(
          ocrError instanceof Error
            ? ocrError.message
            : 'OCR non riuscito. È possibile proseguire con correzione manuale.',
        )
      }
    }
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Lettura PDF non riuscita: ${error.message}`
        : 'Lettura PDF non riuscita in questo browser.',
    )
  }

  // Ricalcola warning header se vuoto.
  if (!parsed.header.documentNumber || !parsed.header.documentDateIso || !parsed.header.supplier) {
    const headerCheck = extractHeaderFields(plainText)
    parsed = {
      ...parsed,
      header: {
        documentNumber: parsed.header.documentNumber || headerCheck.documentNumber,
        documentDate: parsed.header.documentDate || headerCheck.documentDate,
        documentDateIso: parsed.header.documentDateIso || headerCheck.documentDateIso,
        supplier: parsed.header.supplier || headerCheck.supplier,
      },
    }
  }

  onProgress?.({ phase: 'Completato', progress: 1 })

  return {
    fileName,
    pageCount,
    source,
    rawText: plainText,
    header: parsed.header,
    lines: parsed.lines,
    warnings: [...new Set([...warnings, ...parsed.warnings])],
  }
}
