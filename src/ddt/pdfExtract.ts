import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import type { DdtTextItem } from '../types/ddt'

let workerConfigured = false

function ensurePdfWorker(): void {
  if (workerConfigured) {
    return
  }
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()
  workerConfigured = true
}

export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  ensurePdfWorker()
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  })
  return loadingTask.promise
}

export async function extractTextItemsFromPdf(
  data: ArrayBuffer,
): Promise<{ pageCount: number; items: DdtTextItem[]; plainTextLength: number }> {
  const pdf = await loadPdfDocument(data)
  try {
    const items: DdtTextItem[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      for (const raw of content.items) {
        if (!('str' in raw) || typeof raw.str !== 'string') {
          continue
        }
        const transform = 'transform' in raw && Array.isArray(raw.transform) ? raw.transform : null
        const x = transform ? Number(transform[4]) : 0
        const y = transform ? Number(transform[5]) : 0
        items.push({
          str: raw.str,
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          width: typeof raw.width === 'number' ? raw.width : 0,
          height: typeof raw.height === 'number' ? raw.height : 0,
        })
      }
    }

    const plainTextLength = items.reduce((sum, item) => sum + item.str.trim().length, 0)
    return {
      pageCount: pdf.numPages,
      items,
      plainTextLength,
    }
  } finally {
    pdf.cleanup()
  }
}

async function safeCleanup(pdf: PDFDocumentProxy): Promise<void> {
  try {
    pdf.cleanup()
  } catch {
    // Ignora cleanup non disponibile su alcune build.
  }
}

export async function renderPdfPageToCanvas(
  data: ArrayBuffer,
  pageNumber: number,
  scale = 2,
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') {
    throw new Error('Rendering PDF non disponibile fuori dal browser.')
  }

  const pdf = await loadPdfDocument(data)
  try {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Impossibile creare il contesto canvas per l’OCR.')
    }
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise
    return canvas
  } finally {
    await safeCleanup(pdf)
  }
}
