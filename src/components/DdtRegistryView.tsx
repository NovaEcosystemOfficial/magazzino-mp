import { useMemo, useState } from 'react'
import {
  buildDdtRegistry,
  filterDdtRegistry,
  type DdtRegistryEntry,
} from '../ddt/buildDdtRegistry'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import { formatLocalDateLabel } from '../utils/quantity'

type DdtRegistryViewProps = {
  movements: StockMovement[]
  articles: ArticleRecord[]
}

function formatRegisteredAtLabel(isoTimestamp: string): string {
  const trimmed = isoTimestamp.trim()
  if (!trimmed) {
    return '—'
  }
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    return trimmed
  }
  return date.toLocaleString('it-IT')
}

export function DdtRegistryView({ movements, articles }: DdtRegistryViewProps) {
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const registry = useMemo(
    () => buildDdtRegistry(movements, articles),
    [movements, articles],
  )

  const filtered = useMemo(
    () => filterDdtRegistry(registry, { query, dateFrom, dateTo }),
    [registry, query, dateFrom, dateTo],
  )

  const selected: DdtRegistryEntry | null = useMemo(() => {
    if (!selectedId) {
      return null
    }
    return registry.find((entry) => entry.id === selectedId) ?? null
  }, [registry, selectedId])

  const hasActiveFilters = query.trim().length > 0 || dateFrom.length > 0 || dateTo.length > 0

  const clearFilters = () => {
    setQuery('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <section className="ddt-registry-page" aria-labelledby="registro-ddt-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Documenti</p>
        <h3 id="registro-ddt-title">Registro DDT</h3>
        <p className="section-heading__description">
          Consultazione dei documenti di trasporto già importati e registrati. I dati derivano dai
          movimenti di carico esistenti: aprire un documento non modifica le giacenze.
        </p>
      </div>

      {selected ? (
        <div className="panel">
          <div className="article-detail__toolbar">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedId(null)}
            >
              Torna all&apos;elenco
            </button>
          </div>

          <div className="section-heading">
            <p className="section-heading__eyebrow">Dettaglio</p>
            <h3>DDT {selected.documentNumber || '—'}</h3>
          </div>

          <dl className="detail-grid">
            <div className="detail-field">
              <dt className="detail-field__label">Numero DDT</dt>
              <dd className="detail-field__value">{selected.documentNumber || '—'}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Data documento</dt>
              <dd className="detail-field__value">
                {selected.documentDateIso
                  ? formatLocalDateLabel(selected.documentDateIso)
                  : '—'}
              </dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Fornitore</dt>
              <dd className="detail-field__value">{selected.supplier || '—'}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Data registrazione</dt>
              <dd className="detail-field__value">
                {formatRegisteredAtLabel(selected.registeredAt)}
              </dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Righe / articoli</dt>
              <dd className="detail-field__value">{selected.lineCount}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Quantità complessiva</dt>
              <dd className="detail-field__value">{selected.totalQuantityLabel}</dd>
            </div>
          </dl>

          <div className="table-wrap" style={{ marginTop: '1rem' }} aria-label="Righe DDT">
            <table className="articles-table">
              <thead>
                <tr>
                  <th scope="col">Codice</th>
                  <th scope="col">Descrizione</th>
                  <th scope="col">Quantità</th>
                  <th scope="col">Movimento</th>
                  <th scope="col">Registrato il</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Nessuna riga associata a questo documento.</td>
                  </tr>
                ) : (
                  selected.lines.map((line) => (
                    <tr key={line.movementId}>
                      <td>{line.articleCode || '—'}</td>
                      <td>{line.articleDescription}</td>
                      <td>{line.quantityLabel}</td>
                      <td>
                        <code className="ddt-registry-movement-id">{line.movementId}</code>
                      </td>
                      <td>{formatRegisteredAtLabel(line.registeredAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="helper-text" style={{ marginTop: '0.75rem' }}>
            Vista consultativa: nessun carico aggiuntivo viene creato aprendo questo documento.
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="articles-toolbar" aria-label="Filtri registro DDT">
              <label className="field">
                <span className="field__label">Cerca numero o fornitore</span>
                <input
                  type="search"
                  className="field__control"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Es. 798VEND oppure LES BIJOUX"
                  autoComplete="off"
                />
              </label>

              <label className="field">
                <span className="field__label">Data da</span>
                <input
                  type="date"
                  className="field__control"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">Data a</span>
                <input
                  type="date"
                  className="field__control"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>

              <div className="articles-toolbar__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                >
                  Azzera filtri
                </button>
                <p className="helper-text">
                  {filtered.length} document{filtered.length === 1 ? 'o' : 'i'} · totale in archivio{' '}
                  {registry.length}
                </p>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="table-wrap" aria-label="Elenco DDT registrati">
              <table className="articles-table">
                <thead>
                  <tr>
                    <th scope="col">Numero DDT</th>
                    <th scope="col">Data documento</th>
                    <th scope="col">Fornitore</th>
                    <th scope="col">Righe</th>
                    <th scope="col">Quantità tot.</th>
                    <th scope="col">Registrato il</th>
                    <th scope="col">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-state empty-state--articles">
                          <p className="empty-state__message">
                            {registry.length === 0
                              ? 'Nessun DDT importato presente nello storico movimenti.'
                              : 'Nessun documento corrisponde ai filtri di ricerca.'}
                          </p>
                          {hasActiveFilters && registry.length > 0 ? (
                            <p className="empty-state__detail">
                              Prova ad azzerare i filtri o a modificare numero, fornitore o intervallo
                              date.
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.documentNumber || '—'}</td>
                        <td>
                          {entry.documentDateIso
                            ? formatLocalDateLabel(entry.documentDateIso)
                            : '—'}
                        </td>
                        <td>{entry.supplier || '—'}</td>
                        <td>{entry.lineCount}</td>
                        <td>{entry.totalQuantityLabel}</td>
                        <td>{formatRegisteredAtLabel(entry.registeredAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-button secondary-button--compact"
                            onClick={() => setSelectedId(entry.id)}
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
          </div>
        </>
      )}
    </section>
  )
}
