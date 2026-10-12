import { todayLocalIsoDate } from '../utils/quantity'

export type ReportPeriodPreset = 'today' | 'last7' | 'month' | 'custom'

export type ReportPeriod = {
  preset: ReportPeriodPreset
  fromDate: string
  toDate: string
}

function shiftDays(isoDate: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) {
    return isoDate
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setDate(date.getDate() + deltaDays)
  return todayLocalIsoDate(date)
}

export function resolveReportPeriod(
  preset: ReportPeriodPreset,
  customFrom = '',
  customTo = '',
  today = todayLocalIsoDate(),
): ReportPeriod {
  if (preset === 'today') {
    return { preset, fromDate: today, toDate: today }
  }
  if (preset === 'last7') {
    return { preset, fromDate: shiftDays(today, -6), toDate: today }
  }
  if (preset === 'month') {
    const fromDate = `${today.slice(0, 7)}-01`
    return { preset, fromDate, toDate: today }
  }
  const fromDate = customFrom.trim() || today
  const toDate = customTo.trim() || today
  if (fromDate > toDate) {
    return { preset: 'custom', fromDate: toDate, toDate: fromDate }
  }
  return { preset: 'custom', fromDate, toDate }
}

export function isDateInPeriod(isoDate: string, period: ReportPeriod): boolean {
  const value = isoDate.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  return value >= period.fromDate && value <= period.toDate
}

export function periodLabel(period: ReportPeriod): string {
  if (period.preset === 'today') {
    return `Oggi (${period.fromDate})`
  }
  if (period.preset === 'last7') {
    return `Ultimi 7 giorni (${period.fromDate} → ${period.toDate})`
  }
  if (period.preset === 'month') {
    return `Mese corrente (${period.fromDate} → ${period.toDate})`
  }
  return `Personalizzato (${period.fromDate} → ${period.toDate})`
}
