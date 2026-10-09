import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { ArticleDetailView } from './components/ArticleDetailView'
import { ArticlesImportWizard } from './components/ArticlesImportWizard'
import { CarichiView } from './components/CarichiView'
import { SettingsView } from './components/SettingsView'
import { readArticoliWorkbook } from './excel/readArticoliWorkbook'
import { loadAllArticles, persistNewArticles } from './storage/articlesDb'
import { loadAllMovements } from './storage/movementsDb'
import type {
  ArticoliImportSummary,
  ArticoliSheetData,
  ArticleRecord,
} from './types/articles'
import type { StockMovement } from './types/movements'
import { parseNumericStock } from './excel/articoliMapping'
import { formatQuantity, todayLocalIsoDate } from './utils/quantity'

type ViewId =
  | 'dashboard'
  | 'articoli'
  | 'carichi'
  | 'scarichi'
  | 'importazione-ddt'
  | 'movimenti'
  | 'registro-ddt'
  | 'report'
  | 'impostazioni'

type NavigationItem = {
  id: ViewId
  label: string
}

const navigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'articoli', label: 'Articoli' },
  { id: 'carichi', label: 'Carichi' },
  { id: 'scarichi', label: 'Scarichi' },
  { id: 'importazione-ddt', label: 'Importazione DDT' },
  { id: 'movimenti', label: 'Movimenti' },
  { id: 'registro-ddt', label: 'Registro DDT' },
  { id: 'report', label: 'Report' },
  { id: 'impostazioni', label: 'Impostazioni' },
]

const quickActions = [
  {
    id: 'carichi' as const,
    label: 'Carico manuale',
    description: 'Apri la sezione dedicata all’inserimento di nuovi carichi.',
  },
  {
    id: 'scarichi' as const,
    label: 'Nuovo scarico',
    description: 'Prepara la schermata per registrare uno scarico.',
  },
  {
    id: 'importazione-ddt' as const,
    label: 'Importa DDT',
    description: 'Accedi al flusso di importazione dei documenti di trasporto.',
  },
]

const sectionTitles: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  articoli: 'Anagrafica articoli',
  carichi: 'Carichi',
  scarichi: 'Scarichi',
  'importazione-ddt': 'Importazione DDT',
  movimenti: 'Movimenti',
  'registro-ddt': 'Registro DDT',
  report: 'Report',
  impostazioni: 'Impostazioni',
}

function formatCurrentDate(date: Date) {
  const formatted = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function ArticlesView({
  articles,
  codeQuery,
  descriptionQuery,
  importError,
  importSummary,
  isReadingFile,
  isLoadingArticles,
  storageError,
  onCodeQueryChange,
  onDescriptionQueryChange,
  onImportClick,
  onClearSummary,
  onOpenArticle,
}: {
  articles: ArticleRecord[]
  codeQuery: string
  descriptionQuery: string
  importError: string | null
  importSummary: ArticoliImportSummary | null
  isReadingFile: boolean
  isLoadingArticles: boolean
  storageError: string | null
  onCodeQueryChange: (value: string) => void
  onDescriptionQueryChange: (value: string) => void
  onImportClick: () => void
  onClearSummary: () => void
  onOpenArticle: (code: string) => void
}) {
  const filteredRows = articles.filter((row) => {
    const codeMatches =
      codeQuery.trim().length === 0 ||
      row.code.toLowerCase().includes(codeQuery.trim().toLowerCase())
    const descriptionMatches =
      descriptionQuery.trim().length === 0 ||
      row.description.toLowerCase().includes(descriptionQuery.trim().toLowerCase())

    return codeMatches && descriptionMatches
  })

  const hasActiveFilters = codeQuery.trim().length > 0 || descriptionQuery.trim().length > 0

  return (
    <section className="articles-page" aria-labelledby="articoli-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Anagrafica</p>
        <h3 id="articoli-title">Anagrafica articoli</h3>
        <p className="section-heading__description">
          Importa il foglio Articoli da Excel e salva l&apos;anagrafica in IndexedDB. I dati restano
          disponibili dopo aggiornamento o riapertura del browser.
        </p>
      </div>

      {storageError ? (
        <div className="alert alert--error" role="alert">
          <p>{storageError}</p>
        </div>
      ) : null}

      {importError ? (
        <div className="alert alert--error" role="alert">
          <p>{importError}</p>
        </div>
      ) : null}

      {importSummary ? (
        <div
          className={`alert ${importSummary.persisted ? 'alert--success' : 'alert--error'}`}
          role="status"
        >
          <p>
            {importSummary.persisted
              ? 'Salvataggio IndexedDB confermato'
              : 'Salvataggio non confermato'}{' '}
            da <strong>{importSummary.fileName}</strong>: <strong>{importSummary.imported}</strong>{' '}
            nuovi, <strong>{importSummary.enrichedExisting}</strong> esistenti arricchiti,{' '}
            <strong>{importSummary.skippedExisting}</strong> invariati,{' '}
            <strong>{importSummary.ignored}</strong> ignorati, <strong>{importSummary.errors}</strong>{' '}
            con problemi evidenziati.
          </p>
          {importSummary.messages.length > 0 ? (
            <ul className="alert__list">
              {importSummary.messages.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="secondary-button" onClick={onClearSummary}>
            Chiudi riepilogo
          </button>
        </div>
      ) : null}

      <div className="panel articles-panel">
        <div className="articles-toolbar" aria-label="Filtri articoli">
          <label className="field">
            <span className="field__label">Codice articolo</span>
            <input
              type="search"
              className="field__control"
              value={codeQuery}
              onChange={(event) => onCodeQueryChange(event.target.value)}
              placeholder="Cerca per codice"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Descrizione</span>
            <input
              type="search"
              className="field__control"
              value={descriptionQuery}
              onChange={(event) => onDescriptionQueryChange(event.target.value)}
              placeholder="Cerca per descrizione"
              autoComplete="off"
            />
          </label>

          <div className="articles-toolbar__actions">
            <button
              type="button"
              className="primary-button"
              onClick={onImportClick}
              disabled={isReadingFile || isLoadingArticles}
            >
              {isReadingFile ? 'Lettura file…' : 'Importa Excel'}
            </button>
            <p className="helper-text">
              {isLoadingArticles
                ? 'Caricamento archivio locale…'
                : `${articles.length} articoli in IndexedDB.`}
            </p>
          </div>
        </div>

        <div className="table-wrap" aria-label="Tabella anagrafica articoli">
          <table className="articles-table">
            <thead>
              <tr>
                <th scope="col">Codice</th>
                <th scope="col">Descrizione</th>
                <th scope="col">Unità di misura</th>
                <th scope="col">Giacenza</th>
                <th scope="col">Stato</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingArticles ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state empty-state--articles">
                      <p className="empty-state__message">Caricamento anagrafica da IndexedDB…</p>
                    </div>
                  </td>
                </tr>
              ) : filteredRows.length > 0 ? (
                filteredRows.map((row) => (
                  <tr
                    key={row.code}
                    className="articles-table__row--clickable"
                    onClick={() => onOpenArticle(row.code)}
                  >
                    <td>{row.code}</td>
                    <td>{row.description}</td>
                    <td>{row.unitOfMeasure}</td>
                    <td>{row.currentStock}</td>
                    <td>{row.status}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button secondary-button--compact"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenArticle(row.code)
                        }}
                      >
                        Apri scheda
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state empty-state--articles">
                      <p className="empty-state__message">
                        {articles.length === 0
                          ? "Nessun articolo presente. Importa l'anagrafica per iniziare."
                          : 'Nessun articolo corrisponde ai filtri di ricerca.'}
                      </p>
                      {hasActiveFilters && articles.length > 0 ? (
                        <p className="empty-state__detail">
                          Prova a modificare codice o descrizione.
                        </p>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function PlaceholderView({
  title,
  onBackToDashboard,
}: {
  title: string
  onBackToDashboard: () => void
}) {
  return (
    <section className="panel panel--placeholder" aria-labelledby="placeholder-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Sezione in sviluppo</p>
        <h3 id="placeholder-title">{title}</h3>
      </div>

      <p className="placeholder-text">
        Questa area è predisposta per la funzione <strong>{title.toLowerCase()}</strong>, ma la
        logica operativa non è ancora implementata.
      </p>

      <div className="placeholder-actions">
        <button type="button" className="secondary-button" onClick={onBackToDashboard}>
          Torna alla dashboard
        </button>
      </div>
    </section>
  )
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [articleCodeQuery, setArticleCodeQuery] = useState('')
  const [articleDescriptionQuery, setArticleDescriptionQuery] = useState('')
  const [articles, setArticles] = useState<ArticleRecord[]>([])
  const [isLoadingArticles, setIsLoadingArticles] = useState(true)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [importSheetData, setImportSheetData] = useState<ArticoliSheetData | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ArticoliImportSummary | null>(null)
  const [isReadingFile, setIsReadingFile] = useState(false)
  const [isSavingImport, setIsSavingImport] = useState(false)
  const [selectedArticleCode, setSelectedArticleCode] = useState<string | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentDate = useMemo(() => formatCurrentDate(new Date()), [])
  const selectedArticle = useMemo(() => {
    if (!selectedArticleCode) {
      return null
    }
    const key = selectedArticleCode.trim().toLowerCase()
    return articles.find((article) => article.code.trim().toLowerCase() === key) ?? null
  }, [articles, selectedArticleCode])

  const title =
    activeView === 'articoli' && selectedArticleCode
      ? selectedArticle
        ? `Scheda ${selectedArticle.code}`
        : 'Scheda articolo'
      : sectionTitles[activeView]
  const isDashboard = activeView === 'dashboard'
  const existingCodes = useMemo(
    () => new Set(articles.map((article) => article.code.trim().toLowerCase())),
    [articles],
  )

  const monthPrefix = todayLocalIsoDate().slice(0, 7)
  const carichiDelPeriodo = useMemo(
    () =>
      movements.filter(
        (movement) => movement.type === 'CARICO' && movement.movementDate.startsWith(monthPrefix),
      ).length,
    [movements, monthPrefix],
  )

  const totalCurrentStock = useMemo(() => {
    let sum = 0
    let counted = 0
    for (const article of articles) {
      const value = parseNumericStock(article.currentStock)
      if (value !== null) {
        sum += value
        counted += 1
      }
    }
    return counted > 0 ? formatQuantity(sum) : '—'
  }, [articles])

  const dashboardStats = useMemo(
    () => [
      {
        label: 'Articoli in anagrafica',
        value: isLoadingArticles ? '…' : String(articles.length),
        note: storageError
          ? 'Errore di lettura IndexedDB.'
          : articles.length === 0
            ? 'Archivio locale vuoto.'
            : 'Conteggio reale da IndexedDB.',
      },
      {
        label: 'Valore / quantità delle giacenze',
        value: isLoadingArticles ? '…' : totalCurrentStock,
        note: 'Somma delle giacenze operative attuali.',
      },
      {
        label: 'Carichi del periodo',
        value: isLoadingArticles ? '…' : String(carichiDelPeriodo),
        note: 'Movimenti CARICO del mese corrente.',
      },
      {
        label: 'Scarichi del periodo',
        value: '—',
        note: 'Contatore in attesa di logica di magazzino.',
      },
    ],
    [
      articles.length,
      isLoadingArticles,
      storageError,
      totalCurrentStock,
      carichiDelPeriodo,
    ],
  )

  const selectedArticleMovements = useMemo(() => {
    if (!selectedArticleCode) {
      return []
    }
    const key = selectedArticleCode.trim().toLowerCase()
    return movements.filter((movement) => movement.articleId === key)
  }, [movements, selectedArticleCode])

  const recentCarichi = useMemo(
    () => movements.filter((movement) => movement.type === 'CARICO'),
    [movements],
  )

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoadingArticles(true)
      setStorageError(null)

      try {
        const [stored, storedMovements] = await Promise.all([
          loadAllArticles(),
          loadAllMovements(),
        ])
        if (!cancelled) {
          setArticles(stored)
          setMovements(storedMovements)
        }
      } catch (error) {
        if (!cancelled) {
          setArticles([])
          setMovements([])
          setStorageError(
            error instanceof Error
              ? error.message
              : 'Impossibile caricare l’anagrafica da IndexedDB.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingArticles(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const refreshArticlesFromDb = async () => {
    const stored = await loadAllArticles()
    setArticles(stored)
    return stored
  }

  const refreshWarehouseFromDb = async () => {
    const [stored, storedMovements] = await Promise.all([
      loadAllArticles(),
      loadAllMovements(),
    ])
    setArticles(stored)
    setMovements(storedMovements)
  }

  const handleImportClick = () => {
    setImportError(null)
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setIsReadingFile(true)
    setImportError(null)
    setImportSummary(null)

    try {
      const sheetData = await readArticoliWorkbook(file)
      setImportSheetData(sheetData)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Si è verificato un errore imprevisto durante la lettura del file Excel.'
      setImportSheetData(null)
      setImportError(message)
    } finally {
      setIsReadingFile(false)
    }
  }

  const handleImportConfirm = async (
    importedArticles: ArticleRecord[],
    summary: ArticoliImportSummary,
  ) => {
    setIsSavingImport(true)
    setImportError(null)

    try {
      const persistResult = await persistNewArticles(importedArticles)
      const stored = await refreshArticlesFromDb()
      const sampleSaved = persistResult.added[0] ?? persistResult.enrichedExisting[0]
      const sampleSummary = sampleSaved
        ? [
            `Esempio campi salvati (${sampleSaved.code}): giacenza=${sampleSaved.stock}; categoria=${sampleSaved.category}; scorta minima=${sampleSaved.minStock}; fornitore=${sampleSaved.supplier}.`,
          ]
        : []

      setImportSummary({
        ...summary,
        imported: persistResult.added.length,
        skippedExisting: persistResult.skippedExisting.length,
        enrichedExisting: persistResult.enrichedExisting.length,
        persisted: true,
        messages: [
          ...summary.messages,
          `Transazione IndexedDB completata. Totale articoli in archivio: ${stored.length}.`,
          persistResult.enrichedExisting.length > 0
            ? `${persistResult.enrichedExisting.length} articolo/i già presenti sono stati arricchiti con campi mancanti (nessuna sovrascrittura dei valori già valorizzati).`
            : 'Nessun articolo esistente ha richiesto arricchimento.',
          persistResult.skippedExisting.length > 0
            ? `${persistResult.skippedExisting.length} codice/i già completi lasciati invariati.`
            : 'Nessun codice esistente lasciato invariato.',
          ...sampleSummary,
        ],
      })
      setImportSheetData(null)
    } catch (error) {
      setImportError(
        error instanceof Error
          ? `Salvataggio non riuscito: ${error.message}. Nessun nuovo articolo è stato dichiarato salvato.`
          : 'Salvataggio IndexedDB non riuscito. Nessun nuovo articolo è stato dichiarato salvato.',
      )
      setImportSummary(null)
      // Mantieni il wizard aperto solo se vogliamo riprovare; chiudiamo e mostriamo errore in Articoli.
      setImportSheetData(null)
    } finally {
      setIsSavingImport(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navigazione principale">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true" />
          <div>
            <p className="sidebar__eyebrow">Gestione aziendale</p>
            <h1 className="sidebar__title">MAGAZZINO MR</h1>
          </div>
        </div>

        <nav className="sidebar__nav">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar__link${item.id === activeView ? ' sidebar__link--active' : ''}`}
              onClick={() => {
                setActiveView(item.id)
                if (item.id !== 'articoli') {
                  setSelectedArticleCode(null)
                }
              }}
              aria-current={item.id === activeView ? 'page' : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <p className="sidebar__footer-label">Archivio locale</p>
          <p className="sidebar__footer-value">
            {isLoadingArticles ? 'Caricamento…' : `${articles.length} articoli`}
          </p>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <p className="topbar__eyebrow">Sezione corrente</p>
            <h2 className="topbar__title">{title}</h2>
          </div>

          <div className="topbar__meta" aria-label="Informazioni pagina">
            <span>{currentDate}</span>
            <span className="topbar__badge">Archivio locale</span>
          </div>
        </header>

        <main className="main-content">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="visually-hidden"
            onChange={(event) => {
              void handleFileSelected(event)
            }}
            tabIndex={-1}
            aria-hidden="true"
          />

          {isDashboard ? (
            <>
              <section className="card-grid" aria-labelledby="dashboard-riepilogo">
                <div className="section-heading">
                  <p className="section-heading__eyebrow">Panoramica</p>
                  <h3 id="dashboard-riepilogo">Riepilogo rapido</h3>
                </div>

                {storageError ? (
                  <div className="alert alert--error" role="alert">
                    <p>{storageError}</p>
                  </div>
                ) : null}

                <div className="card-grid__items">
                  {dashboardStats.map((card) => (
                    <article key={card.label} className="summary-card">
                      <p className="summary-card__label">{card.label}</p>
                      <strong className="summary-card__value">{card.value}</strong>
                      <p className="summary-card__note">{card.note}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel" aria-labelledby="attivita-recenti">
                <div className="section-heading">
                  <p className="section-heading__eyebrow">Storico</p>
                  <h3 id="attivita-recenti">Attività recenti</h3>
                </div>

                <div className="table-wrap" aria-label="Tabella attività recenti">
                  <table className="activity-table">
                    <thead>
                      <tr>
                        <th scope="col">Data</th>
                        <th scope="col">Operazione</th>
                        <th scope="col">Documento</th>
                        <th scope="col">Articolo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCarichi.length === 0 ? (
                        <tr>
                          <td colSpan={4}>Nessun movimento registrato.</td>
                        </tr>
                      ) : (
                        recentCarichi.slice(0, 8).map((movement) => (
                          <tr key={movement.id}>
                            <td>{movement.movementDate}</td>
                            <td>{movement.type}</td>
                            <td>{movement.documentRef}</td>
                            <td>{movement.articleCode}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel" aria-labelledby="azioni-rapide">
                <div className="section-heading">
                  <p className="section-heading__eyebrow">Operatività</p>
                  <h3 id="azioni-rapide">Azioni rapide</h3>
                </div>

                <div className="quick-actions">
                  {quickActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="quick-action"
                      onClick={() => setActiveView(action.id)}
                    >
                      <span className="quick-action__label">{action.label}</span>
                      <span className="quick-action__description">{action.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : activeView === 'articoli' ? (
            importSheetData ? (
              <ArticlesImportWizard
                sheetData={importSheetData}
                existingCodes={existingCodes}
                isSaving={isSavingImport}
                onCancel={() => {
                  if (!isSavingImport) {
                    setImportSheetData(null)
                  }
                }}
                onConfirm={handleImportConfirm}
              />
            ) : selectedArticleCode ? (
              <ArticleDetailView
                article={selectedArticle}
                requestedCode={selectedArticleCode}
                movements={selectedArticleMovements}
                onBack={() => setSelectedArticleCode(null)}
              />
            ) : (
              <ArticlesView
                articles={articles}
                codeQuery={articleCodeQuery}
                descriptionQuery={articleDescriptionQuery}
                importError={importError}
                importSummary={importSummary}
                isReadingFile={isReadingFile}
                isLoadingArticles={isLoadingArticles}
                storageError={storageError}
                onCodeQueryChange={setArticleCodeQuery}
                onDescriptionQueryChange={setArticleDescriptionQuery}
                onImportClick={handleImportClick}
                onClearSummary={() => setImportSummary(null)}
                onOpenArticle={(code) => setSelectedArticleCode(code)}
              />
            )
          ) : activeView === 'carichi' ? (
            <CarichiView
              articles={articles}
              recentCarichi={recentCarichi}
              onRegistered={refreshWarehouseFromDb}
            />
          ) : activeView === 'impostazioni' ? (
            <SettingsView
              articleCount={articles.length}
              onArticlesReplaced={async () => {
                try {
                  await refreshWarehouseFromDb()
                  setStorageError(null)
                } catch (error) {
                  setStorageError(
                    error instanceof Error
                      ? error.message
                      : 'Impossibile ricaricare l’anagrafica dopo il ripristino.',
                  )
                }
              }}
            />
          ) : (
            <PlaceholderView title={title} onBackToDashboard={() => setActiveView('dashboard')} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
