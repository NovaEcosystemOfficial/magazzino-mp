import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { BRAND_DEFINITIONS, getBrandLabel, type BrandId } from './brands/brands'
import { getActiveBrandId, setActiveBrandId } from './brands/brandPreference'
import { ArticleDetailView } from './components/ArticleDetailView'
import { ArticlesImportWizard } from './components/ArticlesImportWizard'
import { BrandSelectScreen } from './components/BrandSelectScreen'
import { CarichiView } from './components/CarichiView'
import { DdtImportView } from './components/DdtImportView'
import { DdtRegistryView } from './components/DdtRegistryView'
import {
  hasRecentMovementActivity,
  MovementsActivityChart,
} from './components/MovementsActivityChart'
import { MovimentiView } from './components/MovimentiView'
import { ReportView } from './components/ReportView'
import { ScarichiView } from './components/ScarichiView'
import { SettingsView } from './components/SettingsView'
import { SplashScreen } from './components/SplashScreen'
import {
  hasSeenSplashScreen,
  markSplashScreenSeen,
  resetSplashScreenPreference,
} from './splash/splashPreference'
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
import { normalizeUnitForReport } from './report/buildWarehouseReport'
import { formatLocalDateLabel, formatQuantity, todayLocalIsoDate } from './utils/quantity'
import {
  computeCurrentStock,
  movementsForArticle,
  reconcileArticlesWithMovements,
} from './utils/stockBalance'

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

function NavIcon({ id }: { id: ViewId }) {
  const common = {
    className: 'sidebar__link-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (id) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      )
    case 'articoli':
      return (
        <svg {...common}>
          <path d="M4 7h16v12H4z" />
          <path d="M8 7V5h8v2" />
        </svg>
      )
    case 'carichi':
      return (
        <svg {...common}>
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      )
    case 'scarichi':
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M6 13l6 6 6-6" />
        </svg>
      )
    case 'importazione-ddt':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      )
    case 'movimenti':
      return (
        <svg {...common}>
          <path d="M7 7h13" />
          <path d="M16 3l4 4-4 4" />
          <path d="M17 17H4" />
          <path d="M8 13l-4 4 4 4" />
        </svg>
      )
    case 'registro-ddt':
      return (
        <svg {...common}>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </svg>
      )
    case 'report':
      return (
        <svg {...common}>
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M22 19H2" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )
  }
}

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
  movements,
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
  movements: StockMovement[]
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
  const ARTICLES_PREVIEW = 5
  const previewRows = filteredRows.slice(0, ARTICLES_PREVIEW)
  const extraRows = filteredRows.slice(ARTICLES_PREVIEW)

  const renderArticleRow = (row: ArticleRecord) => {
    const stockLabel = computeCurrentStock(
      row.stock,
      movementsForArticle(movements, row.code),
    )
    const stockValue = parseNumericStock(stockLabel)
    const minValue = parseNumericStock(row.minStock)
    const isEmpty = stockValue !== null && stockValue <= 0
    const isLow =
      !isEmpty && stockValue !== null && minValue !== null && stockValue < minValue
    const rowClass = [
      'articles-table__row--clickable',
      isEmpty ? 'articles-table__row--empty' : '',
      isLow ? 'articles-table__row--low' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <tr key={row.code} className={rowClass} onClick={() => onOpenArticle(row.code)}>
        <td>
          <code className="article-code">{row.code}</code>
        </td>
        <td>{row.description}</td>
        <td>{row.unitOfMeasure || '—'}</td>
        <td
          className={`numeric-cell stock-cell${
            isEmpty ? ' stock-cell--empty' : isLow ? ' stock-cell--low' : ' stock-cell--ok'
          }`}
        >
          {stockLabel}
        </td>
        <td>
          {isEmpty ? (
            <span className="status-pill status-pill--danger">Esaurito</span>
          ) : isLow ? (
            <span className="status-pill status-pill--warning">Sotto scorta</span>
          ) : (
            <span className="status-pill status-pill--ok">{row.status || 'OK'}</span>
          )}
        </td>
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
    )
  }

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
                <th scope="col">Giacenza attuale</th>
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
              ) : previewRows.length > 0 ? (
                previewRows.map((row) => renderArticleRow(row))
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

        {!isLoadingArticles && extraRows.length > 0 ? (
          <details className="report-more">
            <summary>Altri {extraRows.length} articoli</summary>
            <div className="table-wrap report-more__table" aria-label="Altri articoli">
              <table className="articles-table">
                <thead>
                  <tr>
                    <th scope="col">Codice</th>
                    <th scope="col">Descrizione</th>
                    <th scope="col">Unità di misura</th>
                    <th scope="col">Giacenza attuale</th>
                    <th scope="col">Stato</th>
                    <th scope="col">Azioni</th>
                  </tr>
                </thead>
                <tbody>{extraRows.map((row) => renderArticleRow(row))}</tbody>
              </table>
            </div>
          </details>
        ) : null}
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
  const [showSplash, setShowSplash] = useState(() => !hasSeenSplashScreen())
  /** Dopo lo splash (o all’apertura se splash già visto) richiede scelta brand esplicita. */
  const [showBrandSelect, setShowBrandSelect] = useState(() => hasSeenSplashScreen())
  const [activeBrandId, setActiveBrandIdState] = useState<BrandId>(() => getActiveBrandId())
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
  const activeBrandLabel = getBrandLabel(activeBrandId)

  const handleEnterGestionale = () => {
    markSplashScreenSeen()
    setShowSplash(false)
    setShowBrandSelect(true)
  }

  const applyBrandSelection = (brandId: BrandId) => {
    setActiveBrandId(brandId)
    setActiveBrandIdState(brandId)
    setSelectedArticleCode(null)
    setImportSheetData(null)
    setImportError(null)
    setImportSummary(null)
    setArticleCodeQuery('')
    setArticleDescriptionQuery('')
    setActiveView('dashboard')
    setShowBrandSelect(false)
  }

  const handleReenableSplashForTesting = () => {
    resetSplashScreenPreference()
    setShowSplash(true)
    setShowBrandSelect(false)
  }

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

  const scarichiDelPeriodo = useMemo(
    () =>
      movements.filter(
        (movement) => movement.type === 'SCARICO' && movement.movementDate.startsWith(monthPrefix),
      ).length,
    [movements, monthPrefix],
  )

  const belowMinCount = useMemo(() => {
    let count = 0
    for (const article of articles) {
      const current = parseNumericStock(article.currentStock)
      const min = parseNumericStock(article.minStock)
      if (current !== null && min !== null && current < min) {
        count += 1
      }
    }
    return count
  }, [articles])

  const stockByUnit = useMemo(() => {
    const map = new Map<string, number>()
    for (const article of articles) {
      const value = parseNumericStock(article.currentStock)
      if (value === null) {
        continue
      }
      const unit = normalizeUnitForReport(article.unitOfMeasure)
      map.set(unit, (map.get(unit) ?? 0) + value)
    }
    return [...map.entries()]
      .map(([unit, quantity]) => ({ unit, quantityLabel: formatQuantity(quantity) }))
      .sort((a, b) => a.unit.localeCompare(b.unit))
  }, [articles])

  const selectedArticleMovements = useMemo(() => {
    if (!selectedArticleCode) {
      return []
    }
    return movementsForArticle(movements, selectedArticleCode)
  }, [movements, selectedArticleCode])

  const recentCarichi = useMemo(
    () => movements.filter((movement) => movement.type === 'CARICO'),
    [movements],
  )

  const recentScarichi = useMemo(
    () => movements.filter((movement) => movement.type === 'SCARICO'),
    [movements],
  )

  const recentMovements = useMemo(() => movements.slice(0, 8), [movements])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoadingArticles(true)
      setStorageError(null)

      try {
        const [stored, storedMovements] = await Promise.all([
          loadAllArticles(activeBrandId),
          loadAllMovements(activeBrandId),
        ])
        if (!cancelled) {
          setArticles(reconcileArticlesWithMovements(stored, storedMovements))
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
  }, [activeBrandId])

  const refreshArticlesFromDb = async () => {
    const [stored, storedMovements] = await Promise.all([
      loadAllArticles(activeBrandId),
      loadAllMovements(activeBrandId),
    ])
    const reconciled = reconcileArticlesWithMovements(stored, storedMovements)
    setArticles(reconciled)
    setMovements(storedMovements)
    return reconciled
  }

  const refreshWarehouseFromDb = async () => {
    const [stored, storedMovements] = await Promise.all([
      loadAllArticles(activeBrandId),
      loadAllMovements(activeBrandId),
    ])
    setArticles(reconcileArticlesWithMovements(stored, storedMovements))
    setMovements(storedMovements)
  }

  const handleBrandChange = (brandId: BrandId) => {
    applyBrandSelection(brandId)
  }

  const handleOpenBrandSelect = () => {
    setShowBrandSelect(true)
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
      const persistResult = await persistNewArticles(importedArticles, activeBrandId)
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

  if (showSplash) {
    return <SplashScreen onEnter={handleEnterGestionale} />
  }

  if (showBrandSelect) {
    return (
      <BrandSelectScreen
        highlightedBrandId={activeBrandId}
        onSelect={applyBrandSelection}
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true">
            MP
          </span>
          <div className="app-header__titles">
            <p className="app-header__product">Magazzino MP</p>
            <p className="app-header__tagline">Gestione Materie Prime</p>
          </div>
        </div>

        <div className="app-header__brands" role="group" aria-label="Selezione brand">
          {BRAND_DEFINITIONS.map((brand) => (
            <button
              key={brand.id}
              type="button"
              className={`brand-chip${brand.id === activeBrandId ? ' brand-chip--active' : ''}`}
              onClick={() => handleBrandChange(brand.id)}
              disabled={isLoadingArticles || isSavingImport}
              aria-pressed={brand.id === activeBrandId}
            >
              {brand.label}
            </button>
          ))}
        </div>

        <div className="app-header__meta">
          <span className="app-header__date">{currentDate}</span>
          <div className="app-header__active" aria-label="Brand attivo">
            <span className="app-header__active-label">Attivo</span>
            <span className="app-header__active-value">{activeBrandLabel}</span>
          </div>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar" aria-label="Navigazione principale">
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
                <NavIcon id={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar__foot">
            <p className="sidebar__foot-stat">
              Archivio
              <strong>{isLoadingArticles ? '…' : `${articles.length} articoli`}</strong>
            </p>
            <button
              type="button"
              className="sidebar__change-brand"
              onClick={handleOpenBrandSelect}
              disabled={isSavingImport}
            >
              Schermata brand
            </button>
          </div>
        </aside>

        <div className="content">
          <header className="page-header">
            <div>
              <p className="page-header__eyebrow">
                {isDashboard
                  ? `Archivio ${activeBrandLabel}`
                  : `Archivio ${activeBrandLabel}`}
              </p>
              <h2 className="page-header__title">{title}</h2>
            </div>
            {isDashboard ? (
              <div className="dashboard__actions">
                <button
                  type="button"
                  className="primary-button primary-button--cta"
                  onClick={() => setActiveView('importazione-ddt')}
                >
                  Importa DDT
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setActiveView('carichi')}
                >
                  Registra carico
                </button>
              </div>
            ) : null}
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
              <div className="dashboard">
                {storageError ? (
                  <div className="alert alert--error" role="alert">
                    <p>{storageError}</p>
                  </div>
                ) : null}

                <section className="dashboard__hero" aria-labelledby="dashboard-giacenze">
                  <article className="stock-hero">
                    <div className="stock-hero__heading">
                      <p className="stock-hero__eyebrow">Giacenza complessiva</p>
                      <h3 id="dashboard-giacenze" className="stock-hero__title">
                        Totali per unità di misura
                      </h3>
                    </div>
                    {isLoadingArticles ? (
                      <p className="helper-text">Caricamento giacenze…</p>
                    ) : stockByUnit.length === 0 ? (
                      <p className="helper-text">Nessuna giacenza numerica disponibile.</p>
                    ) : (
                      <>
                        <div className="stock-hero__units">
                          {stockByUnit.slice(0, 5).map((row) => (
                            <div key={row.unit} className="stock-unit">
                              <span className="stock-unit__value">{row.quantityLabel}</span>
                              <span className="stock-unit__label">{row.unit}</span>
                            </div>
                          ))}
                        </div>
                        {stockByUnit.length > 5 ? (
                          <details className="stock-hero__more">
                            <summary>
                              Altre {stockByUnit.length - 5} unità di misura
                            </summary>
                            <div className="stock-hero__units stock-hero__units--extra">
                              {stockByUnit.slice(5).map((row) => (
                                <div key={row.unit} className="stock-unit">
                                  <span className="stock-unit__value">{row.quantityLabel}</span>
                                  <span className="stock-unit__label">{row.unit}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </>
                    )}
                  </article>

                  <div className="metric-stack">
                    <article
                      className={`metric-tile${belowMinCount > 0 ? ' metric-tile--alert' : ''}`}
                    >
                      <p className="metric-tile__label">Sotto scorta</p>
                      <strong className="metric-tile__value">
                        {isLoadingArticles ? '…' : belowMinCount}
                      </strong>
                      <p className="metric-tile__note">
                        {belowMinCount > 0
                          ? 'Articoli sotto la soglia minima configurata.'
                          : 'Nessun articolo sotto soglia (o soglie non impostate).'}
                      </p>
                    </article>
                    <article className="metric-tile metric-tile--forest">
                      <p className="metric-tile__label">Carichi del mese</p>
                      <strong className="metric-tile__value">
                        {isLoadingArticles ? '…' : carichiDelPeriodo}
                      </strong>
                      <p className="metric-tile__note">Movimenti CARICO nel periodo corrente.</p>
                    </article>
                    <article className="metric-tile">
                      <p className="metric-tile__label">Scarichi del mese</p>
                      <strong className="metric-tile__value">
                        {isLoadingArticles ? '…' : scarichiDelPeriodo}
                      </strong>
                      <p className="metric-tile__note">Movimenti SCARICO nel periodo corrente.</p>
                    </article>
                    <article className="metric-tile">
                      <p className="metric-tile__label">Articoli in anagrafica</p>
                      <strong className="metric-tile__value">
                        {isLoadingArticles ? '…' : articles.length}
                      </strong>
                      <p className="metric-tile__note">
                        {storageError
                          ? 'Errore di lettura IndexedDB.'
                          : articles.length === 0
                            ? 'Archivio locale vuoto.'
                            : 'Conteggio reale da IndexedDB.'}
                      </p>
                    </article>
                  </div>
                </section>

                {!isLoadingArticles && belowMinCount > 0 ? (
                  <div className="alert alert--warning" role="status">
                    <p>
                      Avviso operativo:{' '}
                      <span className="status-pill status-pill--warning">Sotto scorta</span>{' '}
                      {belowMinCount} articol{belowMinCount === 1 ? 'o' : 'i'} sotto la scorta
                      minima.
                    </p>
                  </div>
                ) : null}

                <section className="dashboard__split">
                  {hasRecentMovementActivity(movements) ? (
                    <div className="panel" aria-labelledby="dashboard-chart">
                      <div className="section-heading">
                        <p className="section-heading__eyebrow">Andamento</p>
                        <h3 id="dashboard-chart">Movimenti ultimi 14 giorni</h3>
                        <p className="section-heading__description">
                          Conteggio giornaliero dei movimenti già registrati (nessuna stima).
                        </p>
                      </div>
                      <MovementsActivityChart movements={movements} />
                    </div>
                  ) : null}

                  <div className="panel" aria-labelledby="attivita-recenti">
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
                          {recentMovements.length === 0 ? (
                            <tr>
                              <td colSpan={4}>Nessun movimento registrato.</td>
                            </tr>
                          ) : (
                            recentMovements.map((movement) => (
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
                                <td>
                                  {movement.documentRef ||
                                    (movement.type === 'SCARICO'
                                      ? movement.reason
                                      : movement.supplier) ||
                                    '—'}
                                </td>
                                <td>{movement.articleCode}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
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
              </div>
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
                movements={movements}
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
          ) : activeView === 'scarichi' ? (
            <ScarichiView
              articles={articles}
              recentScarichi={recentScarichi}
              onRegistered={refreshWarehouseFromDb}
            />
          ) : activeView === 'movimenti' ? (
            <MovimentiView movements={movements} articles={articles} />
          ) : activeView === 'importazione-ddt' ? (
            <DdtImportView
              articles={articles}
              activeBrandId={activeBrandId}
              onRegistered={refreshWarehouseFromDb}
            />
          ) : activeView === 'registro-ddt' ? (
            <DdtRegistryView movements={movements} articles={articles} />
          ) : activeView === 'report' ? (
            <ReportView articles={articles} movements={movements} />
          ) : activeView === 'impostazioni' ? (
            <SettingsView
              articleCount={articles.length}
              movementCount={movements.length}
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
              onReenableSplash={handleReenableSplashForTesting}
            />
          ) : (
            <PlaceholderView title={title} onBackToDashboard={() => setActiveView('dashboard')} />
          )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
