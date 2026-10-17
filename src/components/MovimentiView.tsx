import { useMemo, useState } from 'react'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatLocalDateLabel, formatQuantity } from '../utils/quantity'

type MovimentiViewProps = {
  movements: StockMovement[]
  articles: ArticleRecord[]
}

type FilterType = 'ALL' | 'CARICO' | 'SCARICO'

export function MovimentiView({ movements, articles }: MovimentiViewProps) {
  const [filter, setFilter] = useState<FilterType>('ALL')
  const [query, setQuery] = useState('')

  const descriptionByCode = useMemo(() => {
    const map = new Map<string, string>()
    for (const article of articles) {
      map.set(article.code.trim().toLowerCase(), article.description)
    }
    return map
  }, [articles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return movements.filter((movement) => {
      if (filter !== 'ALL' && movement.type !== filter) {
        return false
      }
      if (!q) {
        return true
      }
      const description = descriptionByCode.get(movement.articleId) ?? ''
      return (
        movement.articleCode.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        movement.documentRef.toLowerCase().includes(q) ||
        movement.supplier.toLowerCase().includes(q) ||
        movement.reason.toLowerCase().includes(q)
      )
    })
  }, [movements, filter, query, descriptionByCode])

  return (
    <section className="movimenti-page" aria-labelledby="movimenti-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Storico</p>
        <h3 id="movimenti-title">Movimenti</h3>
        <p className="section-heading__description">
          Elenco dei carichi e degli scarichi dell’archivio attivo. I movimenti registrati non
          sono modificabili; le correzioni avvengono con movimenti compensativi. I dati restano dopo refresh o
          riapertura.
        </p>
      </div>

      <div className="panel">
        <div className="articles-toolbar" aria-label="Filtri movimenti">
          <label className="field">
            <span className="field__label">Cerca</span>
            <input
              type="search"
              className="field__control"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Codice, descrizione, documento…"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Tipo</span>
            <select
              className="field__control"
              value={filter}
              onChange={(event) => setFilter(event.target.value as FilterType)}
            >
              <option value="ALL">Tutti</option>
              <option value="CARICO">Solo carichi</option>
              <option value="SCARICO">Solo scarichi</option>
            </select>
          </label>

          <div className="articles-toolbar__actions">
            <p className="helper-text">{filtered.length} movimenti visualizzati.</p>
          </div>
        </div>

        <div className="table-wrap" aria-label="Tabella movimenti">
          <table className="activity-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Tipo</th>
                <th scope="col">Articolo</th>
                <th scope="col">Descrizione</th>
                <th scope="col">Quantità</th>
                <th scope="col">Causale / Fornitore</th>
                <th scope="col">Documento</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nessun movimento corrisponde ai filtri.</td>
                </tr>
              ) : (
                filtered.map((movement) => (
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
                    <td>{movement.articleCode}</td>
                    <td>{descriptionByCode.get(movement.articleId) ?? '—'}</td>
                    <td>{formatQuantity(movement.quantity)}</td>
                    <td>
                      {movement.type === 'SCARICO'
                        ? movement.reason || '—'
                        : movement.supplier || '—'}
                    </td>
                    <td>{movement.documentRef || '—'}</td>
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
