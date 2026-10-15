import { useMemo, useState } from 'react'
import { buildWarehouseReport } from '../report/buildWarehouseReport'
import { exportWarehouseReportExcel } from '../report/exportReportExcel'
import {
  periodLabel,
  resolveReportPeriod,
  type ReportPeriodPreset,
} from '../report/period'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatLocalDateLabel } from '../utils/quantity'

type ReportViewProps = {
  articles: ArticleRecord[]
  movements: StockMovement[]
}

export function ReportView({ articles, movements }: ReportViewProps) {
  const [preset, setPreset] = useState<ReportPeriodPreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [selectedMovedCode, setSelectedMovedCode] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const period = useMemo(
    () => resolveReportPeriod(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )

  const report = useMemo(
    () => buildWarehouseReport(articles, movements, period),
    [articles, movements, period],
  )

  const selectedMoved = useMemo(() => {
    if (!selectedMovedCode) {
      return null
    }
    return report.movedArticles.find((row) => row.articleCode === selectedMovedCode) ?? null
  }, [report.movedArticles, selectedMovedCode])

  const handleExportExcel = () => {
    setExportError(null)
    setExportMessage(null)
    try {
      exportWarehouseReportExcel(report)
      setExportMessage('Export Excel generato localmente dal report filtrato.')
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : 'Esportazione Excel non riuscita in questo browser.',
      )
    }
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <section className="report-page" aria-labelledby="report-title">
      <div className="section-heading no-print">
        <p className="section-heading__eyebrow">Analisi</p>
        <h3 id="report-title">Report magazzino</h3>
        <p className="section-heading__description">
          Panoramica operativa sui dati già presenti in IndexedDB. Consultazione sola lettura: non
          modifica giacenze né crea movimenti. Le quantità sono separate per unità di misura.
        </p>
      </div>

      <div className="section-heading print-only" aria-hidden="true">
        <h3>Magazzino MP — Report</h3>
        <p>{periodLabel(report.period)}</p>
      </div>

      {exportError ? (
        <div className="alert alert--error no-print" role="alert">
          <p>{exportError}</p>
        </div>
      ) : null}
      {exportMessage ? (
        <div className="alert alert--success no-print" role="status">
          <p>{exportMessage}</p>
        </div>
      ) : null}

      <div className="panel no-print">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Periodo</p>
          <h3>Filtri temporali</h3>
        </div>
        <div className="report-period-actions">
          {(
            [
              ['today', 'Oggi'],
              ['last7', 'Ultimi 7 giorni'],
              ['month', 'Mese corrente'],
              ['custom', 'Personalizzato'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={
                preset === value ? 'primary-button' : 'secondary-button secondary-button--compact'
              }
              onClick={() => setPreset(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {preset === 'custom' ? (
          <div className="mapping-grid" style={{ marginTop: '1rem' }}>
            <label className="field">
              <span className="field__label">Data iniziale</span>
              <input
                type="date"
                className="field__control"
                value={customFrom || period.fromDate}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Data finale</span>
              <input
                type="date"
                className="field__control"
                value={customTo || period.toDate}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <p className="helper-text" style={{ marginTop: '0.75rem' }}>
          Periodo attivo: <strong>{periodLabel(report.period)}</strong>. Le giacenze sotto sono
          sempre quelle attuali; carichi, scarichi e DDT seguono il periodo.
        </p>

        <div className="import-wizard__actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="primary-button" onClick={handleExportExcel}>
            Esporta Excel
          </button>
          <button type="button" className="secondary-button" onClick={handlePrint}>
            Stampa / PDF browser
          </button>
        </div>
        <p className="helper-text">
          PDF: usare la stampa del browser e “Salva come PDF”. Non vengono usati servizi cloud.
        </p>
      </div>

      <div className="card-grid report-summary">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Snapshot</p>
          <h3>Riepilogo magazzino</h3>
        </div>
        <div className="card-grid__items">
          <article className="summary-card">
            <p className="summary-card__label">Articoli in anagrafica</p>
            <strong className="summary-card__value">{report.articleCount}</strong>
            <p className="summary-card__note">Conteggio reale IndexedDB.</p>
          </article>
          <article className="summary-card">
            <p className="summary-card__label">Sotto scorta minima</p>
            <strong className="summary-card__value">{report.belowMinCount}</strong>
            <p className="summary-card__note">
              {report.articlesWithoutMinStock} senza scorta minima configurata.
            </p>
          </article>
          <article className="summary-card">
            <p className="summary-card__label">Carichi nel periodo</p>
            <strong className="summary-card__value">{report.caricoCount}</strong>
            <p className="summary-card__note">Movimenti CARICO nel periodo selezionato.</p>
          </article>
          <article className="summary-card">
            <p className="summary-card__label">Scarichi nel periodo</p>
            <strong className="summary-card__value">{report.scaricoCount}</strong>
            <p className="summary-card__note">Movimenti SCARICO nel periodo selezionato.</p>
          </article>
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Giacenze attuali</p>
          <h3>Totali per unità di misura</h3>
          <p className="section-heading__description">
            Non vengono sommate unità diverse. Articoli senza giacenza numerica:{' '}
            {report.articlesWithoutNumericStock}.
          </p>
        </div>
        <div className="table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th scope="col">Unità di misura</th>
                <th scope="col">Giacenza attuale</th>
              </tr>
            </thead>
            <tbody>
              {report.stockByUnit.length === 0 ? (
                <tr>
                  <td colSpan={2}>Nessuna giacenza numerica disponibile.</td>
                </tr>
              ) : (
                report.stockByUnit.map((row) => (
                  <tr key={row.unit}>
                    <td>{row.unit}</td>
                    <td>{row.quantityLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Periodo</p>
          <h3>Carichi e scarichi</h3>
        </div>
        <div className="table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th scope="col">UdM</th>
                <th scope="col">Entrate</th>
                <th scope="col">Uscite</th>
                <th scope="col">Saldo movimenti</th>
              </tr>
            </thead>
            <tbody>
              {report.saldoByUnit.length === 0 ? (
                <tr>
                  <td colSpan={4}>Nessun movimento nel periodo selezionato.</td>
                </tr>
              ) : (
                report.saldoByUnit.map((row) => {
                  const inQty =
                    report.caricoByUnit.find((item) => item.unit === row.unit)?.quantityLabel ?? '0'
                  const outQty =
                    report.scaricoByUnit.find((item) => item.unit === row.unit)?.quantityLabel ??
                    '0'
                  return (
                    <tr key={row.unit}>
                      <td>{row.unit}</td>
                      <td>{inQty}</td>
                      <td>{outQty}</td>
                      <td>{row.quantityLabel}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="section-heading" style={{ marginTop: '1.25rem' }}>
          <h3>Articoli movimentati nel periodo</h3>
        </div>
        <div className="table-wrap">
          <table className="articles-table">
            <thead>
              <tr>
                <th scope="col">Codice</th>
                <th scope="col">Descrizione</th>
                <th scope="col">UdM</th>
                <th scope="col">Carichi</th>
                <th scope="col">Scarichi</th>
                <th scope="col">Saldo</th>
                <th scope="col" className="no-print">
                  Dettaglio
                </th>
              </tr>
            </thead>
            <tbody>
              {report.movedArticles.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nessun articolo movimentato nel periodo.</td>
                </tr>
              ) : (
                report.movedArticles.map((row) => (
                  <tr key={row.articleCode}>
                    <td>{row.articleCode}</td>
                    <td>{row.description}</td>
                    <td>{row.unitOfMeasure}</td>
                    <td>{row.caricoLabel}</td>
                    <td>{row.scaricoLabel}</td>
                    <td>{row.saldoLabel}</td>
                    <td className="no-print">
                      <button
                        type="button"
                        className="secondary-button secondary-button--compact"
                        onClick={() => setSelectedMovedCode(row.articleCode)}
                      >
                        Apri
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {selectedMoved ? (
          <div className="alert alert--warning no-print" role="status" style={{ marginTop: '1rem' }}>
            <p>
              <strong>{selectedMoved.articleCode}</strong> — {selectedMoved.description}
            </p>
            <ul className="alert__list">
              <li>UdM: {selectedMoved.unitOfMeasure}</li>
              <li>Carichi nel periodo: {selectedMoved.caricoLabel}</li>
              <li>Scarichi nel periodo: {selectedMoved.scaricoLabel}</li>
              <li>Saldo movimenti: {selectedMoved.saldoLabel}</li>
            </ul>
            <button
              type="button"
              className="secondary-button secondary-button--compact"
              onClick={() => setSelectedMovedCode(null)}
            >
              Chiudi dettaglio
            </button>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Scorte</p>
          <h3>Scorta minima</h3>
          <p className="section-heading__description">
            Solo articoli con scorta minima numerica configurata. Evidenziati quelli sotto soglia.
          </p>
        </div>
        <div className="table-wrap">
          <table className="articles-table import-preview-table">
            <thead>
              <tr>
                <th scope="col">Codice</th>
                <th scope="col">Descrizione</th>
                <th scope="col">UdM</th>
                <th scope="col">Giacenza attuale</th>
                <th scope="col">Scorta minima</th>
                <th scope="col">Stato</th>
              </tr>
            </thead>
            <tbody>
              {report.lowStockRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    Nessun articolo con scorta minima configurata in anagrafica.
                  </td>
                </tr>
              ) : (
                report.lowStockRows.slice(0, 5).map((row) => (
                  <tr
                    key={row.code}
                    className={row.belowMin ? 'import-row--warning' : undefined}
                  >
                    <td>{row.code}</td>
                    <td>{row.description}</td>
                    <td>{row.unitOfMeasure}</td>
                    <td>{row.currentStock}</td>
                    <td>{row.minStock}</td>
                    <td>
                      <span
                        className={
                          row.belowMin
                            ? 'status-pill status-pill--warning'
                            : 'status-pill status-pill--ok'
                        }
                      >
                        {row.belowMin ? 'Sotto soglia' : 'Ok'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {report.lowStockRows.length > 5 ? (
          <details className="report-more">
            <summary>
              Altri {report.lowStockRows.length - 5} articoli con scorta minima
            </summary>
            <div className="table-wrap report-more__table">
              <table className="articles-table import-preview-table">
                <thead>
                  <tr>
                    <th scope="col">Codice</th>
                    <th scope="col">Descrizione</th>
                    <th scope="col">UdM</th>
                    <th scope="col">Giacenza attuale</th>
                    <th scope="col">Scorta minima</th>
                    <th scope="col">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lowStockRows.slice(5).map((row) => (
                    <tr
                      key={row.code}
                      className={row.belowMin ? 'import-row--warning' : undefined}
                    >
                      <td>{row.code}</td>
                      <td>{row.description}</td>
                      <td>{row.unitOfMeasure}</td>
                      <td>{row.currentStock}</td>
                      <td>{row.minStock}</td>
                      <td>
                        <span
                          className={
                            row.belowMin
                              ? 'status-pill status-pill--warning'
                              : 'status-pill status-pill--ok'
                          }
                        >
                          {row.belowMin ? 'Sotto soglia' : 'Ok'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Documenti</p>
          <h3>Report DDT</h3>
          <p className="section-heading__description">
            Documenti unici dal Registro DDT (numero + fornitore + data), senza doppi conteggi.
            Documenti nel periodo: {report.ddtCount}.
          </p>
        </div>
        <div className="table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th scope="col">Numero</th>
                <th scope="col">Data</th>
                <th scope="col">Fornitore</th>
                <th scope="col">Righe</th>
                <th scope="col">Qtà tot.</th>
              </tr>
            </thead>
            <tbody>
              {report.ddtInPeriod.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nessun DDT nel periodo selezionato.</td>
                </tr>
              ) : (
                report.ddtInPeriod.slice(0, 20).map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.documentNumber}</td>
                    <td>{formatLocalDateLabel(entry.documentDateIso)}</td>
                    <td>{entry.supplier}</td>
                    <td>{entry.lineCount}</td>
                    <td>{entry.totalQuantityLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
