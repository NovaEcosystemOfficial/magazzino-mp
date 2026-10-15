import { parseNumericStock } from '../excel/articoliMapping'
import {
  buildSavedFieldsSummary,
  enrichArticleFromSourceFields,
} from '../excel/resolveArticleFields'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatLocalDateLabel, formatQuantity } from '../utils/quantity'
import { buildArticleStockBalance } from '../utils/stockBalance'

type ArticleDetailViewProps = {
  article: ArticleRecord | null
  requestedCode: string
  movements: StockMovement[]
  onBack: () => void
}

function DetailField({
  label,
  value,
  emphasize,
}: {
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="detail-field">
      <dt className="detail-field__label">{label}</dt>
      <dd className={`detail-field__value${emphasize ? ' detail-field__value--stock' : ''}`}>
        {value?.trim() ? value : '—'}
      </dd>
    </div>
  )
}

export function ArticleDetailView({
  article,
  requestedCode,
  movements,
  onBack,
}: ArticleDetailViewProps) {
  if (!article) {
    return (
      <section className="panel panel--placeholder" aria-labelledby="articolo-non-trovato">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Anagrafica</p>
          <h3 id="articolo-non-trovato">Articolo non trovato</h3>
        </div>
        <p className="placeholder-text">
          Nessun articolo con codice <strong>{requestedCode}</strong> è presente nell&apos;archivio
          locale IndexedDB.
        </p>
        <div className="placeholder-actions">
          <button type="button" className="secondary-button" onClick={onBack}>
            Torna all&apos;anagrafica
          </button>
        </div>
      </section>
    )
  }

  const view = enrichArticleFromSourceFields(article)
  const balance = buildArticleStockBalance(view.stock, movements)
  const currentStockValue = balance.currentStockValue
  const minStockValue = parseNumericStock(view.minStock)
  const isBelowMin =
    Number.isFinite(currentStockValue) &&
    minStockValue !== null &&
    currentStockValue < minStockValue

  const workbookTotalReceivedValue = parseNumericStock(view.totalReceived)
  const showWorkbookTotalReceived = workbookTotalReceivedValue !== null
  const savedSummary = buildSavedFieldsSummary(view)
  const primaryHeaders = new Set(
    [
      'codice',
      'descrizione',
      'unità di misura',
      'unita di misura',
      'u.m.',
      'um',
      'giacenza',
      'giacenze',
      'giacenza foglio',
      'stato',
      'stato foglio',
      'categoria',
      'fornitore',
      'fornitore abituale',
      'scorta minima',
      'scorta min',
      'totale entrate',
      'totale entrate ricevuto',
      'totale entrate (ricevuto)',
      'ricevuto',
    ].map((label) => label.toLowerCase()),
  )

  const additionalFields = Object.entries(view.sourceFields).filter(([header, value]) => {
    if (!value.trim()) {
      return false
    }
    return !primaryHeaders.has(header.trim().toLowerCase())
  })

  return (
    <section className="article-detail" aria-labelledby="articolo-dettaglio-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Scheda articolo</p>
        <h3 id="articolo-dettaglio-title">{view.code}</h3>
        <p className="section-heading__description">{view.description}</p>
      </div>

      <div className="article-detail__toolbar">
        <button type="button" className="secondary-button" onClick={onBack}>
          Torna all&apos;anagrafica
        </button>
        {isBelowMin ? (
          <span className="stock-warning" role="status">
            Giacenza attuale inferiore alla scorta minima
          </span>
        ) : null}
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Dati anagrafici</p>
          <h3>Informazioni principali</h3>
        </div>

        <dl className="detail-grid">
          <DetailField label="Codice articolo" value={view.code} />
          <DetailField label="Descrizione" value={view.description} />
          <DetailField label="Unità di misura" value={view.unitOfMeasure} />
          <DetailField label="Giacenza iniziale (Excel)" value={view.stock} />
          <DetailField label="Totale entrate" value={balance.totalInLabel} />
          <DetailField label="Totale uscite" value={balance.totalOutLabel} />
          <DetailField label="Giacenza attuale" value={balance.currentStock} emphasize />
          <DetailField label="Stato" value={view.status} />
          <DetailField label="Categoria" value={view.category} />
          <DetailField label="Fornitore abituale" value={view.supplier} />
          <DetailField label="Scorta minima" value={view.minStock} />
          {showWorkbookTotalReceived ? (
            <DetailField
              label="Totale entrate workbook (storico)"
              value={view.totalReceived}
            />
          ) : null}
        </dl>

        <p className="helper-text">
          Giacenza attuale = giacenza iniziale + totale entrate − totale uscite (dai movimenti
          registrati). Il totale entrate workbook resta un dato storico Excel e non entra nel
          calcolo operativo.
        </p>

        {isBelowMin ? (
          <div className="alert alert--warning" role="status">
            <p>
              Giacenza attuale ({balance.currentStock}) inferiore alla scorta minima ({view.minStock}).
            </p>
          </div>
        ) : null}
      </div>

      <div className="panel" aria-labelledby="campi-salvati-title">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Verifica persistenza</p>
          <h3 id="campi-salvati-title">Campi effettivamente salvati</h3>
        </div>
        <ul className="saved-fields-summary">
          {savedSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>Giacenza attuale: {balance.currentStock}</li>
          <li>Totale entrate (movimenti): {balance.totalInLabel}</li>
          <li>Totale uscite (movimenti): {balance.totalOutLabel}</li>
        </ul>
      </div>

      {additionalFields.length > 0 ? (
        <div className="panel">
          <div className="section-heading">
            <p className="section-heading__eyebrow">Workbook</p>
            <h3>Altri campi importati</h3>
          </div>
          <dl className="detail-grid">
            {additionalFields.map(([header, value]) => (
              <DetailField key={header} label={header} value={value} />
            ))}
          </dl>
        </div>
      ) : null}

      <div className="panel" aria-labelledby="movimenti-articolo">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Storico</p>
          <h3 id="movimenti-articolo">Movimenti</h3>
        </div>
        {movements.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__message">Nessun movimento registrato.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Quantità</th>
                  <th scope="col">Causale / Fornitore</th>
                  <th scope="col">Documento</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatLocalDateLabel(movement.movementDate)}</td>
                    <td>
                      <span
                        className={
                          movement.type === 'CARICO'
                            ? 'status-pill status-pill--carico'
                            : 'status-pill status-pill--scarico'
                        }
                      >
                        {movement.type}
                      </span>
                    </td>
                    <td className="numeric-cell">{formatQuantity(movement.quantity)}</td>
                    <td>
                      {movement.type === 'SCARICO'
                        ? movement.reason || '—'
                        : movement.supplier || '—'}
                    </td>
                    <td>{movement.documentRef || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
