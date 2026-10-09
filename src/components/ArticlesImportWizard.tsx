import { useMemo, useState } from 'react'
import {
  buildArticoliPreview,
  isMappingComplete,
  issueLabel,
  previewRowsToArticles,
} from '../excel/buildArticoliPreview'
import { REQUIRED_TARGET_FIELDS, TARGET_FIELD_LABELS } from '../excel/articoliMapping'
import type {
  ArticoliImportSummary,
  ArticoliPreviewResult,
  ArticoliSheetData,
  ArticleRecord,
  ArticleTargetField,
  ColumnMapping,
} from '../types/articles'

type WizardStep = 'mapping' | 'preview'

type ArticlesImportWizardProps = {
  sheetData: ArticoliSheetData
  existingCodes: ReadonlySet<string>
  isSaving: boolean
  onCancel: () => void
  onConfirm: (articles: ArticleRecord[], summary: ArticoliImportSummary) => Promise<void> | void
}

function collectExtraHeaders(preview: ArticoliPreviewResult): string[] {
  const headers = new Set<string>()
  for (const row of preview.rows) {
    Object.keys(row.extraFields).forEach((header) => headers.add(header))
  }
  return [...headers]
}

function SurroundingRowsPreview({ sheetData }: { sheetData: ArticoliSheetData }) {
  const columnCount = Math.max(
    1,
    ...sheetData.surroundingRows.map((row) => row.cells.length),
    sheetData.columns.length,
  )

  return (
    <div className="surrounding-preview">
      <p className="helper-text">
        Anteprima delle righe circostanti (numeri di riga Excel). La riga individuata come intestazione
        è evidenziata.
      </p>
      <div className="table-wrap" aria-label="Anteprima righe circostanti il foglio Articoli">
        <table className="articles-table surrounding-table">
          <thead>
            <tr>
              <th scope="col">Riga Excel</th>
              {Array.from({ length: columnCount }, (_, index) => (
                <th key={index} scope="col">
                  Col. {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheetData.surroundingRows.map((row) => (
              <tr
                key={row.excelRowNumber}
                className={row.isHeaderRow ? 'surrounding-row--header' : undefined}
              >
                <td>
                  {row.excelRowNumber}
                  {row.isHeaderRow ? ' (intestazione)' : ''}
                </td>
                {Array.from({ length: columnCount }, (_, index) => (
                  <td key={index}>{row.cells[index] || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ArticlesImportWizard({
  sheetData,
  existingCodes,
  isSaving,
  onCancel,
  onConfirm,
}: ArticlesImportWizardProps) {
  const [mapping, setMapping] = useState<ColumnMapping>(sheetData.suggestedMapping)
  const [step, setStep] = useState<WizardStep>(sheetData.mappingIsCertain ? 'preview' : 'mapping')

  const preview = useMemo(
    () => buildArticoliPreview(sheetData, mapping, existingCodes),
    [sheetData, mapping, existingCodes],
  )
  const extraHeaders = useMemo(() => collectExtraHeaders(preview), [preview])
  const mappingReady = isMappingComplete(mapping)
  const existingCount = preview.rows.filter((row) => row.issues.includes('existing_in_archive')).length
  const newCount = preview.importableCount
  // Righe che possono essere persistite: nuove OPPURE già in archivio da arricchire.
  const persistableCount = preview.rows.filter(
    (row) =>
      row.willImport || (row.issues.includes('existing_in_archive') && Boolean(row.code.trim())),
  ).length
  const missingCodeRows = preview.rows.filter((row) => row.issues.includes('missing_code'))
  const invalidStockRows = preview.rows.filter((row) => row.issues.includes('invalid_stock'))
  const duplicateOnlyRows = preview.rows.filter(
    (row) =>
      row.issues.includes('duplicate_code') &&
      !row.willImport &&
      !row.issues.includes('existing_in_archive'),
  )
  const canConfirm = persistableCount > 0 && !isSaving
  const blockReasons = useMemo(() => {
    const reasons: string[] = []
    if (isSaving) {
      reasons.push('Salvataggio già in corso.')
    }
    if (persistableCount === 0) {
      reasons.push(
        'Nessuna riga confermabile: non ci sono articoli nuovi da salvare né articoli già in archivio da arricchire.',
      )
      if (missingCodeRows.length > 0) {
        reasons.push(
          `${missingCodeRows.length} riga/e senza codice (es. Excel ${missingCodeRows
            .slice(0, 5)
            .map((row) => row.excelRowNumber)
            .join(', ')}${missingCodeRows.length > 5 ? '…' : ''}).`,
        )
      }
      if (duplicateOnlyRows.length > 0) {
        reasons.push(
          `${duplicateOnlyRows.length} riga/e sono solo duplicati interni al file e non verranno salvate.`,
        )
      }
      if (preview.rows.length === 0) {
        reasons.push('L’anteprima non contiene righe dati.')
      }
    }
    return reasons
  }, [
    isSaving,
    persistableCount,
    missingCodeRows,
    duplicateOnlyRows,
    preview.rows.length,
  ])

  const handleFieldChange = (field: ArticleTargetField, header: string) => {
    setMapping((current) => {
      const next: ColumnMapping = { ...current }
      if (!header) {
        delete next[field]
      } else {
        next[field] = header
      }
      return next
    })
  }

  const handleConfirm = async () => {
    // Passa anche i codici già presenti: verranno arricchiti senza sovrascrivere i campi pieni.
    const articles = previewRowsToArticles(preview, mapping)
    const messages: string[] = []

    if (preview.duplicateCodes.length > 0) {
      messages.push(
        `Codici duplicati nel file: ${preview.duplicateCodes.slice(0, 8).join(', ')}${
          preview.duplicateCodes.length > 8 ? '…' : ''
        }. È stata considerata solo la prima occorrenza di ciascun codice.`,
      )
    }

    if (existingCount > 0) {
      messages.push(
        `${existingCount} codice/i già in archivio verranno arricchiti solo nei campi mancanti (nessuna sovrascrittura dei valori già valorizzati).`,
      )
    }

    const missingCodeCount = preview.rows.filter((row) => row.issues.includes('missing_code')).length
    if (missingCodeCount > 0) {
      messages.push(`${missingCodeCount} riga/e senza codice non saranno importate.`)
    }

    messages.push(
      'La giacenza iniziale viene salvata come dato storico del workbook; non vengono creati movimenti di magazzino.',
    )

    await onConfirm(articles, {
      imported: preview.importableCount,
      ignored: preview.ignoredCount,
      errors: preview.errorCount,
      skippedExisting: existingCount,
      enrichedExisting: 0,
      fileName: sheetData.fileName,
      messages,
      persisted: false,
    })
  }

  return (
    <section className="panel import-wizard" aria-labelledby="import-wizard-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Importazione Excel</p>
        <h3 id="import-wizard-title">Anagrafica da workbook</h3>
        <p className="section-heading__description">
          File: <strong>{sheetData.fileName}</strong> · Foglio: <strong>{sheetData.sheetName}</strong> ·
          Intestazione individuata alla riga Excel <strong>{sheetData.headerRowNumber}</strong>
          {sheetData.headerDetectionReliable ? '' : ' (da verificare)'}.
          Il file originale non viene modificato. Il salvataggio avviene in IndexedDB solo dopo la
          conferma e solo se la transazione ha successo.
        </p>
        <p className="helper-text">{sheetData.headerDetectionReason}</p>
      </div>

      {step === 'mapping' ? (
        <div className="import-wizard__body">
          <div className="empty-state">
            <p className="empty-state__message">
              Il riconoscimento automatico non è affidabile al 100%. Associa manualmente i campi
              dell&apos;anagrafica alle intestazioni reali della riga {sheetData.headerRowNumber}.
            </p>
          </div>

          <SurroundingRowsPreview sheetData={sheetData} />

          <div className="mapping-grid" aria-label="Associazione colonne">
            {(Object.keys(TARGET_FIELD_LABELS) as ArticleTargetField[]).map((field) => (
              <label key={field} className="field">
                <span className="field__label">
                  {TARGET_FIELD_LABELS[field]}
                  {REQUIRED_TARGET_FIELDS.includes(field) ? ' *' : ''}
                </span>
                <select
                  className="field__control"
                  value={mapping[field] ?? ''}
                  onChange={(event) => handleFieldChange(field, event.target.value)}
                  disabled={isSaving}
                >
                  <option value="">Non associata</option>
                  {sheetData.columns.map((column) => (
                    <option key={column.header} value={column.header}>
                      {column.header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="import-wizard__actions">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={isSaving}>
              Annulla
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!mappingReady || isSaving}
              onClick={() => setStep('preview')}
            >
              Continua all&apos;anteprima
            </button>
          </div>
        </div>
      ) : (
        <div className="import-wizard__body">
          <div className="import-summary-cards" aria-label="Riepilogo anteprima">
            <article className="summary-card summary-card--compact">
              <p className="summary-card__label">Riga intestazione</p>
              <strong className="summary-card__value">{sheetData.headerRowNumber}</strong>
            </article>
            <article className="summary-card summary-card--compact">
              <p className="summary-card__label">Nuovi da salvare</p>
              <strong className="summary-card__value">{newCount}</strong>
            </article>
            <article className="summary-card summary-card--compact">
              <p className="summary-card__label">Da arricchire</p>
              <strong className="summary-card__value">{existingCount}</strong>
            </article>
          </div>

          <p className="helper-text">
            Conferma consentita per {persistableCount} riga/e ({newCount} nuove, {existingCount} già
            in archivio da arricchire). I campi già valorizzati non vengono sovrascritti. Nessun
            movimento di magazzino viene creato.
          </p>

          {invalidStockRows.length > 0 ? (
            <div className="alert alert--warning" role="status">
              <p>
                {invalidStockRows.length} riga/e con giacenza non numerica (es. Excel{' '}
                {invalidStockRows
                  .slice(0, 8)
                  .map((row) => row.excelRowNumber)
                  .join(', ')}
                {invalidStockRows.length > 8 ? '…' : ''}). Queste righe restano confermabili: la
                giacenza non valida non viene inventata né convertita in zero.
              </p>
            </div>
          ) : null}

          {missingCodeRows.length > 0 ? (
            <div className="alert alert--warning" role="status">
              <p>
                {missingCodeRows.length} riga/e senza codice non saranno salvate (Excel{' '}
                {missingCodeRows
                  .slice(0, 8)
                  .map((row) => row.excelRowNumber)
                  .join(', ')}
                {missingCodeRows.length > 8 ? '…' : ''}).
              </p>
            </div>
          ) : null}

          {!canConfirm ? (
            <div className="alert alert--error" role="alert">
              <p>Conferma non consentita:</p>
              <ul className="alert__list">
                {blockReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!sheetData.headerDetectionReliable ? (
            <SurroundingRowsPreview sheetData={sheetData} />
          ) : null}

          <div className="table-wrap" aria-label="Anteprima importazione articoli">
            <table className="articles-table import-preview-table">
              <thead>
                <tr>
                  <th scope="col">Riga</th>
                  <th scope="col">Codice</th>
                  <th scope="col">Descrizione</th>
                  <th scope="col">Unità di misura</th>
                  <th scope="col">Giacenza foglio</th>
                  <th scope="col">Stato foglio</th>
                  {extraHeaders.map((header) => (
                    <th key={header} scope="col">
                      {header}
                    </th>
                  ))}
                  <th scope="col">Problemi</th>
                  <th scope="col">Esito</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const rowClass = [
                    row.issues.includes('missing_code') ? 'import-row--error' : '',
                    row.issues.includes('duplicate_code') ||
                    row.issues.includes('invalid_stock') ||
                    row.issues.includes('existing_in_archive')
                      ? 'import-row--warning'
                      : '',
                    !row.willImport ? 'import-row--ignored' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <tr key={`${row.excelRowNumber}-${row.code}`} className={rowClass || undefined}>
                      <td>{row.excelRowNumber}</td>
                      <td>{row.code || '—'}</td>
                      <td>{row.description || '—'}</td>
                      <td>{row.unitOfMeasure || '—'}</td>
                      <td>{row.stock || '—'}</td>
                      <td>{row.status || '—'}</td>
                      {extraHeaders.map((header) => (
                        <td key={header}>{row.extraFields[header] || '—'}</td>
                      ))}
                      <td>
                        {row.issues.length > 0
                          ? row.issues.map((issue) => issueLabel(issue)).join(', ')
                          : 'Nessuno'}
                      </td>
                      <td>
                        {row.willImport
                          ? 'Sarà salvato (nuovo)'
                          : row.issues.includes('existing_in_archive')
                            ? 'Sarà arricchito (già in archivio)'
                            : 'Non importato'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="import-wizard__actions">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={isSaving}>
              Annulla
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep('mapping')}
              disabled={isSaving}
            >
              {sheetData.mappingIsCertain ? 'Rivedi associazione colonne' : 'Modifica associazione'}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canConfirm}
              title={
                canConfirm
                  ? 'Conferma salvataggio/arricchimento in IndexedDB'
                  : blockReasons.join(' ')
              }
              aria-describedby={!canConfirm ? 'import-confirm-blocked' : undefined}
              onClick={() => {
                void handleConfirm()
              }}
            >
              {isSaving
                ? 'Salvataggio in corso…'
                : persistableCount > 0 && newCount === 0
                  ? `Conferma arricchimento (${existingCount})`
                  : 'Conferma e salva in archivio'}
            </button>
          </div>
          {!canConfirm ? (
            <p id="import-confirm-blocked" className="helper-text">
              Il pulsante è disabilitato: {blockReasons.join(' ')}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
