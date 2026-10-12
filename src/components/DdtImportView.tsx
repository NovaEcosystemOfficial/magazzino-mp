import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  formatDdtAlreadyRegisteredMessage,
} from '../ddt/ddtDocumentIdentity'
import { extractDdtFromPdf } from '../ddt/extractDdt'
import { applyManualArticleSelection, matchExtractedLinesToArticles } from '../ddt/matchDdtRows'
import {
  getRegistrableRows,
  headerToDdtIdentity,
  registerDdtCarichi,
} from '../ddt/registerDdtCarichi'
import { findCarichiForDdtDocument } from '../storage/movementsDb'
import type { ArticleRecord } from '../types/articles'
import type { DdtEditableRow, DdtHeaderFields, DdtImportSummary } from '../types/ddt'
import {
  formatLocalDateLabel,
  formatQuantity,
  parseQuantityInput,
  todayLocalIsoDate,
} from '../utils/quantity'

type DdtImportViewProps = {
  articles: ArticleRecord[]
  onRegistered: () => Promise<void> | void
}

type WizardStep = 'upload' | 'review' | 'confirm' | 'done'

function italianToIso(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) {
    return ''
  }
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function isoToItalian(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) {
    return value
  }
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function DdtImportView({ articles, onRegistered }: DdtImportViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const savingLockRef = useRef(false)

  const [step, setStep] = useState<WizardStep>('upload')
  const [fileName, setFileName] = useState('')
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [header, setHeader] = useState<DdtHeaderFields>({
    documentNumber: '',
    documentDate: '',
    documentDateIso: '',
    supplier: '',
  })
  const [rows, setRows] = useState<DdtEditableRow[]>([])
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([])
  const [extractionSource, setExtractionSource] = useState<string>('')
  const [progressLabel, setProgressLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [summary, setSummary] = useState<DdtImportSummary | null>(null)
  const [articleSearchByRow, setArticleSearchByRow] = useState<Record<string, string>>({})
  const [documentDuplicateWarning, setDocumentDuplicateWarning] = useState<string | null>(null)

  const { registrable, blocked } = useMemo(() => getRegistrableRows(rows), [rows])
  const includedCount = rows.filter((row) => row.included).length

  const refreshDocumentDuplicateWarning = async (nextHeader: DdtHeaderFields) => {
    const identity = headerToDdtIdentity(nextHeader)
    if (
      !identity.documentNumber ||
      !identity.supplier ||
      !/^\d{4}-\d{2}-\d{2}$/.test(identity.documentDateIso)
    ) {
      setDocumentDuplicateWarning(null)
      return null
    }
    try {
      const existing = await findCarichiForDdtDocument(identity)
      if (existing.length === 0) {
        setDocumentDuplicateWarning(null)
        return null
      }
      const message = formatDdtAlreadyRegisteredMessage(identity, existing.length)
      setDocumentDuplicateWarning(message)
      return message
    } catch {
      // Non bloccare l’editing se la lettura storico fallisce: il gate in registrazione resta attivo.
      setDocumentDuplicateWarning(null)
      return null
    }
  }

  const resetSoft = () => {
    setStep('upload')
    setFileName('')
    setFileBuffer(null)
    setHeader({
      documentNumber: '',
      documentDate: '',
      documentDateIso: '',
      supplier: '',
    })
    setRows([])
    setExtractionWarnings([])
    setExtractionSource('')
    setProgressLabel(null)
    setError(null)
    setSuccess(null)
    setSummary(null)
    setArticleSearchByRow({})
    setDocumentDuplicateWarning(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const runExtraction = async (file: File, buffer: ArrayBuffer, forceOcr = false) => {
    setIsExtracting(true)
    setError(null)
    setSuccess(null)
    setSummary(null)
    setProgressLabel('Avvio estrazione…')

    try {
      const result = await extractDdtFromPdf({
        fileName: file.name,
        data: buffer,
        forceOcr,
        onProgress: (info) => {
          const pct =
            typeof info.progress === 'number' ? ` (${Math.round(info.progress * 100)}%)` : ''
          setProgressLabel(`${info.phase}${info.detail ? `: ${info.detail}` : ''}${pct}`)
        },
      })

      const matched = matchExtractedLinesToArticles(result.lines, articles)
      setFileName(result.fileName)
      setFileBuffer(buffer)
      setHeader({
        documentNumber: result.header.documentNumber,
        documentDate: result.header.documentDate || isoToItalian(result.header.documentDateIso),
        documentDateIso: result.header.documentDateIso || italianToIso(result.header.documentDate),
        supplier: result.header.supplier,
      })
      setRows(matched)
      setExtractionWarnings(result.warnings)
      setExtractionSource(result.source)
      setStep('review')
      setProgressLabel(null)
      await refreshDocumentDuplicateWarning({
        documentNumber: result.header.documentNumber,
        documentDate: result.header.documentDate || isoToItalian(result.header.documentDateIso),
        documentDateIso: result.header.documentDateIso || italianToIso(result.header.documentDate),
        supplier: result.header.supplier,
      })
    } catch (extractError) {
      setError(
        extractError instanceof Error
          ? extractError.message
          : 'Estrazione DDT non riuscita in questo browser.',
      )
      setProgressLabel(null)
    } finally {
      setIsExtracting(false)
    }
  }

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('Selezionare un file PDF.')
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      setFileName(file.name)
      setFileBuffer(buffer)
      await runExtraction(file, buffer, false)
    } catch (readError) {
      setError(
        readError instanceof Error
          ? `Lettura file non riuscita: ${readError.message}`
          : 'Lettura file non riuscita.',
      )
    }
  }

  const updateHeaderField = <K extends keyof DdtHeaderFields>(key: K, value: DdtHeaderFields[K]) => {
    setHeader((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'documentDate') {
        next.documentDateIso = italianToIso(String(value)) || prev.documentDateIso
      }
      if (key === 'documentDateIso') {
        next.documentDate = isoToItalian(String(value))
      }
      void refreshDocumentDuplicateWarning(next)
      return next
    })
    setStep((current) => (current === 'confirm' ? 'review' : current))
  }

  const updateRow = (id: string, patch: Partial<DdtEditableRow>) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) {
          return row
        }
        const next = { ...row, ...patch }
        if (patch.included === false) {
          next.matchStatus = 'excluded'
        } else if (patch.included === true && next.matchedArticleCode) {
          next.matchStatus = 'matched'
        } else if (patch.included === true && !next.matchedArticleCode) {
          next.matchStatus = 'da_verificare'
        }
        return next
      }),
    )
    setStep((current) => (current === 'confirm' ? 'review' : current))
  }

  const handleQuantityChange = (id: string, value: string) => {
    const parsed = parseQuantityInput(value)
    updateRow(id, {
      quantityRaw: value,
      quantity: parsed.ok ? parsed.value : null,
    })
  }

  const handleSelectArticle = (rowId: string, article: ArticleRecord) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? applyManualArticleSelection(row, article) : row)),
    )
    setArticleSearchByRow((prev) => ({
      ...prev,
      [rowId]: `${article.code} — ${article.description}`,
    }))
    setStep((current) => (current === 'confirm' ? 'review' : current))
  }

  const canPrepareConfirm =
    header.documentNumber.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(header.documentDateIso) &&
    header.supplier.trim().length > 0 &&
    registrable.length > 0 &&
    blocked.length === 0

  const handlePrepareConfirm = () => {
    void (async () => {
      setError(null)
      if (!canPrepareConfirm) {
        setError(
          blocked[0]?.reason ??
            'Completare numero DDT, data, fornitore e associazioni articolo prima del riepilogo.',
        )
        return
      }
      const duplicateMessage = await refreshDocumentDuplicateWarning(header)
      if (duplicateMessage) {
        setError(duplicateMessage)
        return
      }
      setStep('confirm')
    })()
  }

  const handleConfirmRegister = async () => {
    if (isSaving || savingLockRef.current) {
      return
    }
    savingLockRef.current = true
    setIsSaving(true)
    setError(null)

    try {
      const result = await registerDdtCarichi({
        fileName,
        header,
        rows,
      })
      await onRegistered()
      setSummary(result.summary)
      if (result.summary.alreadyRegisteredDocument) {
        setDocumentDuplicateWarning(result.summary.messages[0] ?? null)
        setSuccess(null)
        setError(result.summary.messages[0] ?? 'DDT già registrato. Nessuna giacenza modificata.')
        setStep('review')
      } else {
        setSuccess(
          `Registrazione completata: ${result.summary.registered} nuovi carichi` +
            (result.summary.skippedAlreadyApplied
              ? `, ${result.summary.skippedAlreadyApplied} già presenti (idempotenza).`
              : '.'),
        )
        setStep('done')
      }
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : 'Registrazione carichi da DDT non riuscita.',
      )
    } finally {
      setIsSaving(false)
      savingLockRef.current = false
    }
  }

  return (
    <section className="ddt-page" aria-labelledby="ddt-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Documenti</p>
        <h3 id="ddt-title">Importazione DDT</h3>
        <p className="section-heading__description">
          Importa un PDF di documento di trasporto (anche scansionato). L&apos;estrazione è locale e
          non registra movimenti finché non confermi esplicitamente.
        </p>
      </div>

      {error ? (
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="alert alert--success" role="status">
          <p>{success}</p>
        </div>
      ) : null}

      {progressLabel ? (
        <div className="alert alert--warning" role="status">
          <p>{progressLabel}</p>
        </div>
      ) : null}

      {documentDuplicateWarning && !error ? (
        <div className="alert alert--warning" role="status">
          <p>{documentDuplicateWarning}</p>
        </div>
      ) : null}

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">File</p>
          <h3>Selezione PDF</h3>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          onChange={(event) => {
            void handleFileSelected(event)
          }}
          tabIndex={-1}
          aria-hidden="true"
        />

        <div className="import-wizard__actions">
          <button
            type="button"
            className="primary-button"
            disabled={isExtracting || isSaving}
            onClick={() => fileInputRef.current?.click()}
          >
            {isExtracting ? 'Estrazione in corso…' : 'Seleziona PDF'}
          </button>
          {fileName ? (
            <p className="helper-text">
              File selezionato: <strong>{fileName}</strong>
              {extractionSource ? ` · origine testo: ${extractionSource}` : ''}
            </p>
          ) : (
            <p className="helper-text">Nessun file selezionato.</p>
          )}
          {fileBuffer && fileName ? (
            <button
              type="button"
              className="secondary-button"
              disabled={isExtracting || isSaving}
              onClick={() => {
                void runExtraction(new File([fileBuffer], fileName, { type: 'application/pdf' }), fileBuffer, true)
              }}
            >
              Rielabora con OCR
            </button>
          ) : null}
          {step !== 'upload' ? (
            <button
              type="button"
              className="secondary-button"
              disabled={isExtracting || isSaving}
              onClick={resetSoft}
            >
              Annulla importazione
            </button>
          ) : null}
        </div>

        <p className="helper-text">
          Il documento resta sul dispositivo. Non viene dichiarato alcun archivio su Desktop: il
          salvataggio riguarda solo i carichi confermati in IndexedDB.
        </p>
      </div>

      {extractionWarnings.length > 0 && step !== 'upload' ? (
        <div className="alert alert--warning" role="status">
          <p>Avvisi di estrazione</p>
          <ul className="alert__list">
            {extractionWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(step === 'review' || step === 'confirm' || step === 'done') && (
        <>
          <div className="panel">
            <div className="section-heading">
              <p className="section-heading__eyebrow">Intestazione</p>
              <h3>Dati documento</h3>
            </div>

            <div className="mapping-grid">
              <label className="field">
                <span className="field__label">Numero DDT *</span>
                <input
                  type="text"
                  className="field__control"
                  value={header.documentNumber}
                  disabled={step === 'done' || isSaving}
                  onChange={(event) => updateHeaderField('documentNumber', event.target.value)}
                  autoComplete="off"
                />
              </label>

              <label className="field">
                <span className="field__label">Data DDT *</span>
                <input
                  type="date"
                  className="field__control"
                  value={header.documentDateIso || todayLocalIsoDate()}
                  disabled={step === 'done' || isSaving}
                  onChange={(event) => updateHeaderField('documentDateIso', event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">Fornitore *</span>
                <input
                  type="text"
                  className="field__control"
                  value={header.supplier}
                  disabled={step === 'done' || isSaving}
                  onChange={(event) => updateHeaderField('supplier', event.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="section-heading">
              <p className="section-heading__eyebrow">Righe</p>
              <h3>Anteprima modificabile</h3>
              <p className="section-heading__description">
                Associa gli articoli solo quando il codice è certo. In caso contrario seleziona
                manualmente dall&apos;anagrafica oppure escludi la riga.
              </p>
            </div>

            <div className="table-wrap" aria-label="Righe DDT estratte">
              <table className="articles-table import-preview-table">
                <thead>
                  <tr>
                    <th scope="col">Incl.</th>
                    <th scope="col">#</th>
                    <th scope="col">Descrizione DDT</th>
                    <th scope="col">Cod. candidato</th>
                    <th scope="col">Articolo anagrafica</th>
                    <th scope="col">Qtà</th>
                    <th scope="col">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-state">
                          <p className="empty-state__message">
                            Nessuna riga estratta. Puoi riprovare con OCR o inserire i dati dopo aver
                            verificato il PDF.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const rowClass =
                        !row.included
                          ? undefined
                          : row.matchStatus === 'da_verificare' ||
                              row.quantity === null ||
                              row.extractionConfidence === 'low'
                            ? 'import-row--warning'
                            : row.matchStatus === 'matched'
                              ? undefined
                              : 'import-row--error'

                      const search = articleSearchByRow[row.id] ?? ''
                      const q = search.trim().toLowerCase()
                      const suggestions =
                        q.length < 1
                          ? []
                          : articles
                              .filter(
                                (article) =>
                                  article.code.toLowerCase().includes(q) ||
                                  article.description.toLowerCase().includes(q),
                              )
                              .slice(0, 6)

                      return (
                        <tr key={row.id} className={rowClass}>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.included}
                              disabled={step === 'done' || isSaving}
                              onChange={(event) =>
                                updateRow(row.id, { included: event.target.checked })
                              }
                              aria-label={`Includi riga ${row.lineNumber}`}
                            />
                          </td>
                          <td>{row.lineNumber}</td>
                          <td>
                            <div className="ddt-row-desc">
                              <input
                                type="text"
                                className="field__control"
                                value={row.description}
                                disabled={step === 'done' || isSaving || !row.included}
                                onChange={(event) =>
                                  updateRow(row.id, { description: event.target.value })
                                }
                              />
                              {row.warnings.length > 0 ? (
                                <ul className="ddt-row-warnings">
                                  {row.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </td>
                          <td>{row.articleCodeCandidate || '—'}</td>
                          <td>
                            {row.matchedArticleCode ? (
                              <div className="ddt-match-block">
                                <strong>{row.matchedArticleCode}</strong>
                                <span>{row.matchedArticleDescription}</span>
                                {step !== 'done' ? (
                                  <button
                                    type="button"
                                    className="secondary-button secondary-button--compact"
                                    disabled={isSaving || !row.included}
                                    onClick={() =>
                                      updateRow(row.id, {
                                        matchedArticleCode: null,
                                        matchedArticleDescription: null,
                                        matchStatus: 'da_verificare',
                                      })
                                    }
                                  >
                                    Cambia
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <div className="ddt-match-block">
                                <span className="stock-warning">Da verificare</span>
                                <input
                                  type="search"
                                  className="field__control"
                                  placeholder="Cerca in anagrafica…"
                                  value={search}
                                  disabled={step === 'done' || isSaving || !row.included}
                                  onChange={(event) =>
                                    setArticleSearchByRow((prev) => ({
                                      ...prev,
                                      [row.id]: event.target.value,
                                    }))
                                  }
                                  autoComplete="off"
                                />
                                {suggestions.length > 0 ? (
                                  <div className="ddt-suggestions">
                                    {suggestions.map((article) => (
                                      <button
                                        key={article.code}
                                        type="button"
                                        className="secondary-button secondary-button--compact"
                                        onClick={() => handleSelectArticle(row.id, article)}
                                      >
                                        {article.code} — {article.description}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="field__control"
                              value={row.quantityRaw}
                              disabled={step === 'done' || isSaving || !row.included}
                              onChange={(event) => handleQuantityChange(row.id, event.target.value)}
                              aria-label={`Quantità riga ${row.lineNumber}`}
                            />
                          </td>
                          <td>
                            {!row.included
                              ? 'Esclusa'
                              : row.matchStatus === 'matched'
                                ? 'Pronta'
                                : 'Da verificare'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {step === 'review' ? (
              <div className="import-wizard__actions" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canPrepareConfirm || isSaving || Boolean(documentDuplicateWarning)}
                  onClick={handlePrepareConfirm}
                >
                  Prepara riepilogo ({registrable.length} carichi)
                </button>
                {!canPrepareConfirm ? (
                  <p className="helper-text">
                    Incluse: {includedCount}. Bloccate: {blocked.length}. Completare le righe
                    evidenziate.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}

      {step === 'confirm' ? (
        <div className="panel">
          <div className="section-heading">
            <p className="section-heading__eyebrow">Conferma</p>
            <h3>Riepilogo registrazione</h3>
          </div>

          <dl className="detail-grid">
            <div className="detail-field">
              <dt className="detail-field__label">File</dt>
              <dd className="detail-field__value">{fileName}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Numero DDT</dt>
              <dd className="detail-field__value">{header.documentNumber}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Data</dt>
              <dd className="detail-field__value">
                {formatLocalDateLabel(header.documentDateIso)}
              </dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Fornitore</dt>
              <dd className="detail-field__value">{header.supplier}</dd>
            </div>
          </dl>

          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table className="activity-table">
              <thead>
                <tr>
                  <th scope="col">Articolo</th>
                  <th scope="col">Descrizione</th>
                  <th scope="col">Quantità</th>
                </tr>
              </thead>
              <tbody>
                {registrable.map((row) => (
                  <tr key={row.id}>
                    <td>{row.matchedArticleCode}</td>
                    <td>{row.matchedArticleDescription}</td>
                    <td>{row.quantity !== null ? formatQuantity(row.quantity) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="helper-text">
            Anteprima non ancora salvata. Annullando non vengono creati movimenti.
          </p>

          <div className="import-wizard__actions">
            <button
              type="button"
              className="secondary-button"
              disabled={isSaving}
              onClick={() => setStep('review')}
            >
              Torna alle correzioni
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={isSaving}
              onClick={() => {
                void handleConfirmRegister()
              }}
            >
              {isSaving ? 'Registrazione…' : `Conferma ${registrable.length} carichi`}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'done' && summary ? (
        <div className="panel">
          <div className="section-heading">
            <p className="section-heading__eyebrow">Esito</p>
            <h3>Registrazione DDT</h3>
          </div>
          <p>
            Documento <strong>{summary.documentNumber}</strong> del{' '}
            {formatLocalDateLabel(summary.documentDateIso)} · fornitore {summary.supplier}.
          </p>
          <p>
            Nuovi carichi: <strong>{summary.registered}</strong> · già presenti:{' '}
            <strong>{summary.skippedAlreadyApplied}</strong> · righe escluse:{' '}
            <strong>{summary.excluded}</strong>.
          </p>
          {summary.messages.length > 0 ? (
            <ul className="alert__list">
              {summary.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          <div className="import-wizard__actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="primary-button" onClick={resetSoft}>
              Nuova importazione
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
