import type { DdtExtractedLine, DdtHeaderFields, DdtTextItem } from '../types/ddt'
import { linesToPlainText, reconstructLines, type ReconstructedLine } from './reconstructLines'
import { parseQuantityInput } from '../utils/quantity'

const FOOTER_STOP =
  /\b(trasporto\s+a\s+mezzo|causale\s+trasporto|inizio\s+trasporto|firma\s+(conducente|vettore|destinatario)|vettore|porto|aspetto\s+esteriore|peso|colli|data\s+ritiro|ora\s+ritiro|campionario|c\.a\.|rif+t?\.?)\b/i

const HEADER_NOISE =
  /\b(descrizione|quantit[aà]|articolo|arlicolo|u\.?m\.?|prezzo|importo|iva|sc\s*%|pag\.?\s*\d+)\b/i

const ART_LINE = /^\s*art\.?\s+/i

const CONTINUATION_STOP =
  /\b(rift?\.?|rif\.?|campionario|c\.a\.|trasporto|vettore|firma|porto|peso|colli)\b/i

function italianDateToIso(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) {
    return ''
  }
  const day = match[1].padStart(2, '0')
  const month = match[2].padStart(2, '0')
  const year = match[3]
  return `${year}-${month}-${day}`
}

function createLineId(lineNumber: number, rawText: string): string {
  const compact = rawText.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
  return `L${lineNumber}:${compact}`
}

export function extractHeaderFields(plainText: string): DdtHeaderFields & { warnings: string[] } {
  const warnings: string[] = []
  const compact = plainText.replace(/\s+/g, ' ')

  let documentNumber = ''
  const docMatch =
    /D\.?\s*d\.?\s*T\.?\s*n\.?\s*([A-Z0-9][A-Z0-9\/\-]*)/i.exec(compact) ??
    /\bn\.\s*([0-9]+[A-Z]*)\s+del\s+\d{1,2}\/\d{1,2}\/\d{4}/i.exec(compact)
  if (docMatch) {
    documentNumber = docMatch[1].trim()
  } else {
    warnings.push('Numero DDT non riconosciuto automaticamente.')
  }

  let documentDate = ''
  const dateMatch =
    /del\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(compact) ??
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/.exec(compact)
  if (dateMatch) {
    documentDate = dateMatch[1]
  } else {
    warnings.push('Data DDT non riconosciuta automaticamente.')
  }

  let supplier = ''
  const bijoux = /LES\s+BIJOUX\s+S\.?\s*R\.?\s*L\.?/i.exec(compact)
  if (bijoux) {
    supplier = 'LES BIJOUX S.R.L.'
  } else {
    const company =
      /([A-ZÀ-Ü][A-ZÀ-Ü0-9 .,&'’\-]{2,60}?S\.?\s*R\.?\s*L\.?)/.exec(compact) ??
      /([A-ZÀ-Ü][A-ZÀ-Ü0-9 .,&'’\-]{2,60}?S\.?\s*P\.?\s*A\.?)/.exec(compact)
    if (company) {
      const candidate = company[1].replace(/\s+/g, ' ').trim()
      // Evita di prendere il destinatario "Spett." se possibile: preferisci aziende in coda al testo.
      const lowerHalf = compact.slice(Math.floor(compact.length * 0.45))
      if (lowerHalf.toLowerCase().includes(candidate.toLowerCase().slice(0, 12))) {
        supplier = candidate.replace(/,\s*-?\s*$/, '').trim()
      } else {
        supplier = candidate.replace(/,\s*-?\s*$/, '').trim()
      }
    } else {
      warnings.push('Fornitore non riconosciuto automaticamente.')
    }
  }

  return {
    documentNumber,
    documentDate,
    documentDateIso: documentDate ? italianDateToIso(documentDate) : '',
    supplier,
    warnings,
  }
}

function parseQuantityToken(raw: string): { quantity: number | null; quantityRaw: string } {
  const cleaned = raw.replace(/\s/g, '')
  if (!cleaned) {
    return { quantity: null, quantityRaw: '' }
  }
  const parsed = parseQuantityInput(cleaned.replace('.', ','))
  if (parsed.ok) {
    return { quantity: parsed.value, quantityRaw: cleaned }
  }
  // Prova anche formato 6.00 all’inglese.
  const asNumber = Number(cleaned.replace(',', '.'))
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return { quantity: asNumber, quantityRaw: cleaned }
  }
  return { quantity: null, quantityRaw: cleaned }
}

function findQuantityNear(
  lines: ReconstructedLine[],
  index: number,
): { quantity: number | null; quantityRaw: string; fromIndex: number | null } {
  const windowIndexes = [index, index - 1, index + 1, index - 2, index + 2]
  for (const candidateIndex of windowIndexes) {
    if (candidateIndex < 0 || candidateIndex >= lines.length) {
      continue
    }
    const text = lines[candidateIndex].text
    if (ART_LINE.test(text) && candidateIndex !== index) {
      continue
    }
    const matches = [...text.matchAll(/\b(\d{1,6}(?:[.,]\d{1,3})?)\b/g)]
    for (const match of matches) {
      const token = match[1]
      // Evita date e CAP/P.IVA lunghi.
      if (/^\d{5,}$/.test(token.replace(/[.,]/g, ''))) {
        continue
      }
      if (/^\d{1,2}[.,]\d{2}$/.test(token) || /^\d{1,4}$/.test(token)) {
        const parsed = parseQuantityToken(token)
        if (parsed.quantity !== null) {
          return { ...parsed, fromIndex: candidateIndex }
        }
      }
    }
  }
  return { quantity: null, quantityRaw: '', fromIndex: null }
}

function extractArticleCodeCandidate(description: string): string {
  const artMatch = /\bart\.?\s*([A-Za-z0-9][A-Za-z0-9._\-\/]{1,24})\b/i.exec(description)
  if (!artMatch) {
    return ''
  }
  const token = artMatch[1].trim()
  // Token troppo generici non sono codici.
  if (/^(in|di|da|per|the|and|oro|argento)$/i.test(token)) {
    return ''
  }
  return token
}

function normalizeDescription(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\bart\.?\s+/gi, 'art. ')
    // Rimuove quantità tabellari e token UdM residuali (“n”, “n.”) senza toccare pezzi come PS12.
    .replace(/\b\d{1,6}(?:[.,]\d{1,3})\b/g, ' ')
    .replace(/(?:^|\s)n\.?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Estrae le righe articolo senza unire descrizioni distinte.
 * Le quantità restano associate alla riga più vicina geometricamente.
 */
export function extractArticleLines(lines: ReconstructedLine[]): {
  lines: DdtExtractedLine[]
  warnings: string[]
} {
  const warnings: string[] = []
  const result: DdtExtractedLine[] = []
  const consumedQuantityIndexes = new Set<number>()

  let i = 0
  let lineNumber = 0
  while (i < lines.length) {
    const current = lines[i]
    if (FOOTER_STOP.test(current.text)) {
      break
    }
    if (!ART_LINE.test(current.text) || HEADER_NOISE.test(current.text)) {
      i += 1
      continue
    }

    let description = current.text
    let j = i + 1
    while (j < lines.length) {
      const next = lines[j]
      if (
        ART_LINE.test(next.text) ||
        FOOTER_STOP.test(next.text) ||
        HEADER_NOISE.test(next.text) ||
        CONTINUATION_STOP.test(next.text)
      ) {
        break
      }
      // Continuazione descrizione: testo alfabetico senza quantità dominante.
      const looksLikeQtyOnly = /^\s*[nN]?\s*\d{1,6}(?:[.,]\d{1,3})?\s*$/.test(next.text)
      if (looksLikeQtyOnly) {
        break
      }
      // Solo continuazioni brevi (es. colore “gunmetal” spezzato sulla riga successiva).
      const compact = next.text.replace(/\s+/g, ' ').trim()
      if (/^[a-zà-ü][a-zà-ü0-9 \-\/]{0,24}$/i.test(compact) && compact.split(' ').length <= 3) {
        description = `${description} ${compact}`
        j += 1
        continue
      }
      break
    }

    description = normalizeDescription(description)
    const quantityInfo = findQuantityNear(lines, i)
    if (quantityInfo.fromIndex !== null) {
      consumedQuantityIndexes.add(quantityInfo.fromIndex)
    }

    lineNumber += 1
    const articleCodeCandidate = extractArticleCodeCandidate(description)
    const rowWarnings: string[] = []
    let confidence: DdtExtractedLine['confidence'] = 'high'

    if (!articleCodeCandidate) {
      rowWarnings.push('Codice articolo non individuato nella riga.')
      confidence = 'low'
    } else {
      // "art. mr108" è un riferimento di stile: non è automaticamente il codice anagrafica.
      rowWarnings.push(
        `Riferimento estratto “${articleCodeCandidate}”: da verificare nell’anagrafica prima della registrazione.`,
      )
      confidence = 'medium'
    }

    if (quantityInfo.quantity === null) {
      rowWarnings.push('Quantità mancante o non riconosciuta.')
      confidence = 'low'
    }

    // Evita di confondere pezzi di descrizione con quantità (es. PS12).
    if (/\bps\d+\b/i.test(description) && quantityInfo.quantityRaw) {
      const psMatch = /\bps(\d+)\b/i.exec(description)
      if (psMatch && Number(psMatch[1]) === quantityInfo.quantity) {
        rowWarnings.push('Possibile ambiguità tra codice descrittivo e quantità: verificare.')
        confidence = 'low'
      }
    }

    result.push({
      id: createLineId(lineNumber, description),
      lineNumber,
      rawText: description,
      articleCodeCandidate,
      description,
      unitOfMeasure: '',
      quantityRaw: quantityInfo.quantityRaw,
      quantity: quantityInfo.quantity,
      confidence,
      warnings: rowWarnings,
    })

    i = Math.max(i + 1, j)
  }

  if (result.length === 0) {
    warnings.push('Nessuna riga articolo riconoscibile (pattern “art. …”).')
  }

  return { lines: result, warnings }
}

export function parseDdtFromTextItems(items: DdtTextItem[]): {
  header: DdtHeaderFields
  lines: DdtExtractedLine[]
  plainText: string
  warnings: string[]
} {
  const reconstructed = reconstructLines(items)
  const plainText = linesToPlainText(reconstructed)
  const headerResult = extractHeaderFields(plainText)
  const { warnings: headerWarnings, ...header } = headerResult
  const articleResult = extractArticleLines(reconstructed)
  return {
    header,
    lines: articleResult.lines,
    plainText,
    warnings: [...headerWarnings, ...articleResult.warnings],
  }
}

export function parseDdtFromPlainText(plainText: string): {
  header: DdtHeaderFields
  lines: DdtExtractedLine[]
  plainText: string
  warnings: string[]
} {
  const synthetic: ReconstructedLine[] = plainText
    .split(/\r?\n/)
    .map((text, index) => ({
      y: 10000 - index * 12,
      text: text.trim(),
      items: [],
    }))
    .filter((line) => line.text.length > 0)

  const headerResult = extractHeaderFields(plainText)
  const { warnings: headerWarnings, ...header } = headerResult
  const articleResult = extractArticleLines(synthetic)
  return {
    header,
    lines: articleResult.lines,
    plainText,
    warnings: [...headerWarnings, ...articleResult.warnings],
  }
}
