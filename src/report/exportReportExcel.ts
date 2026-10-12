import * as XLSX from 'xlsx'
import { formatLocalDateLabel } from '../utils/quantity'
import { periodLabel } from './period'
import type { WarehouseReport } from './buildWarehouseReport'

function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string): void {
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Esporta il report filtrato in Excel locale (SheetJS già presente).
 * Non scrive su IndexedDB.
 */
export function exportWarehouseReportExcel(report: WarehouseReport): void {
  const workbook = XLSX.utils.book_new()

  const summary = [
    ['Magazzino MP — Report operativo'],
    ['Periodo', periodLabel(report.period)],
    ['Generato il', new Date().toISOString()],
    [],
    ['Articoli in anagrafica', report.articleCount],
    ['Articoli con giacenza numerica', report.articlesWithNumericStock],
    ['Articoli senza giacenza numerica', report.articlesWithoutNumericStock],
    ['Articoli sotto scorta minima', report.belowMinCount],
    ['Articoli senza scorta minima configurata', report.articlesWithoutMinStock],
    ['Carichi nel periodo (n. movimenti)', report.caricoCount],
    ['Scarichi nel periodo (n. movimenti)', report.scaricoCount],
    ['DDT nel periodo (documenti unici)', report.ddtCount],
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), 'Riepilogo')

  const stockRows = [
    ['Unità di misura', 'Giacenza attuale'],
    ...report.stockByUnit.map((row) => [row.unit, row.quantity]),
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(stockRows), 'Giacenze UdM')

  const flowRows = [
    ['Unità', 'Entrate (carichi)', 'Uscite (scarichi)', 'Saldo movimenti'],
    ...report.saldoByUnit.map((saldo) => {
      const inQty = report.caricoByUnit.find((item) => item.unit === saldo.unit)?.quantity ?? 0
      const outQty = report.scaricoByUnit.find((item) => item.unit === saldo.unit)?.quantity ?? 0
      return [saldo.unit, inQty, outQty, saldo.quantity]
    }),
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(flowRows), 'Flussi periodo')

  const movedRows = [
    ['Codice', 'Descrizione', 'UdM', 'Carichi', 'Scarichi', 'Saldo'],
    ...report.movedArticles.map((row) => [
      row.articleCode,
      row.description,
      row.unitOfMeasure,
      row.caricoQty,
      row.scaricoQty,
      row.saldo,
    ]),
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(movedRows), 'Articoli movimentati')

  const lowRows = [
    ['Codice', 'Descrizione', 'UdM', 'Giacenza attuale', 'Scorta minima', 'Sotto soglia'],
    ...report.lowStockRows.map((row) => [
      row.code,
      row.description,
      row.unitOfMeasure,
      row.currentStock,
      row.minStock,
      row.belowMin ? 'Sì' : 'No',
    ]),
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(lowRows), 'Scorte minime')

  const ddtRows = [
    ['Numero DDT', 'Data documento', 'Fornitore', 'Righe', 'Quantità tot.', 'Registrato il'],
    ...report.ddtInPeriod.map((entry) => [
      entry.documentNumber,
      formatLocalDateLabel(entry.documentDateIso),
      entry.supplier,
      entry.lineCount,
      entry.totalQuantityLabel,
      entry.registeredAt,
    ]),
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(ddtRows), 'DDT periodo')

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  downloadWorkbook(
    workbook,
    `magazzino-mp-report-${report.period.fromDate}_${report.period.toDate}-${stamp}.xlsx`,
  )
}
