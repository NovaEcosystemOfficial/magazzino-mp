import { createWorker } from 'tesseract.js'
import { renderPdfPageToCanvas } from './pdfExtract'

export type OcrProgress = {
  status: string
  progress: number
}

/**
 * OCR locale nel browser. Il PDF non viene inviato a server esterni:
 * solo il rendering in-memory viene passato al worker Tesseract.
 */
export async function ocrPdfPages(
  data: ArrayBuffer,
  pageCount: number,
  onProgress?: (info: OcrProgress) => void,
): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = []
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null

  try {
    worker = await createWorker('ita+eng', undefined, {
      logger: (message) => {
        if (message.status) {
          onProgress?.({
            status: message.status,
            progress: typeof message.progress === 'number' ? message.progress : 0,
          })
        }
      },
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'errore sconosciuto'
    throw new Error(
      `OCR non disponibile in questo browser (${detail}). I dati già inseriti non vengono persi: puoi correggere manualmente o riprovare con un PDF testuale.`,
    )
  }

  try {
    const parts: string[] = []
    const maxPages = Math.min(pageCount, 8)
    if (pageCount > maxPages) {
      warnings.push(
        `OCR limitato alle prime ${maxPages} pagine su ${pageCount} per ragioni di prestazioni locali.`,
      )
    }

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      onProgress?.({
        status: `OCR pagina ${pageNumber}/${maxPages}`,
        progress: (pageNumber - 1) / maxPages,
      })
      const canvas = await renderPdfPageToCanvas(data, pageNumber, 2.2)
      const result = await worker.recognize(canvas)
      parts.push(result.data.text ?? '')
    }

    const text = parts.join('\n').replace(/\u0000/g, '').trim()
    if (!text) {
      warnings.push('OCR completato senza testo utilizzabile.')
    }
    return { text, warnings }
  } finally {
    if (worker) {
      await worker.terminate()
    }
  }
}
