import { parseNumericStock } from '../excel/articoliMapping'

/**
 * Interpreta una quantità in formato italiano/internazionale.
 * Rifiuta valori ambigui (es. più separatori inconsistenti).
 */
export function parseQuantityInput(value: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, error: 'Inserire una quantità.' }
  }

  const compact = trimmed.replace(/\s/g, '')
  const commaCount = (compact.match(/,/g) ?? []).length
  const dotCount = (compact.match(/\./g) ?? []).length

  if (commaCount > 1 && dotCount > 0) {
    return { ok: false, error: 'Formato quantità ambiguo: troppi separatori.' }
  }
  if (commaCount > 1) {
    return { ok: false, error: 'Formato quantità non valido.' }
  }
  if (dotCount > 1 && commaCount === 0) {
    // Potrebbe essere migliaia stile 1.234.567 — ammesso solo se pattern migliaia
    if (!/^-?\d{1,3}(\.\d{3})+$/.test(compact) && !/^-?\d{1,3}(\.\d{3})+,\d+$/.test(compact)) {
      return { ok: false, error: 'Formato quantità ambiguo.' }
    }
  }

  const parsed = parseNumericStock(trimmed)
  if (parsed === null) {
    return { ok: false, error: 'La quantità deve essere numerica e finita.' }
  }
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: 'La quantità non è un numero finito.' }
  }
  if (parsed <= 0) {
    return { ok: false, error: 'La quantità deve essere strettamente maggiore di zero.' }
  }

  return { ok: true, value: parsed }
}

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  // Conserva fino a 6 decimali utili senza notazione scientifica.
  const fixed = value.toFixed(6).replace(/\.?0+$/, '')
  return fixed
}

export function addQuantities(current: string, delta: number): string {
  const base = parseNumericStock(current)
  const start = base ?? 0
  return formatQuantity(start + delta)
}

export function subtractQuantities(current: string, delta: number): string {
  if (!Number.isFinite(delta) || delta < 0) {
    throw new Error('La quantità da sottrarre deve essere numerica e non negativa.')
  }
  return addQuantities(current, -delta)
}

/** True se la giacenza corrente copre la quantità richiesta. */
export function stockCoversQuantity(currentStock: string, quantity: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return false
  }
  const base = parseNumericStock(currentStock)
  const available = base ?? 0
  return available + 1e-9 >= quantity
}

export function todayLocalIsoDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLocalDateLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!match) {
    return isoDate
  }
  return `${match[3]}/${match[2]}/${match[1]}`
}
