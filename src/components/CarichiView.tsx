import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { movementActorFromAuth } from '../auth/movementActor'
import type { BrandId } from '../brands/brands'
import type { ArticleRecord } from '../types/articles'
import type { StockMovement } from '../types/movements'
import {
  addQuantities,
  formatLocalDateLabel,
  formatQuantity,
  parseQuantityInput,
  todayLocalIsoDate,
} from '../utils/quantity'
import { registerCarico } from '../storage/warehouseRepository'

type CarichiViewProps = {
  articles: ArticleRecord[]
  recentCarichi: StockMovement[]
  brandId: BrandId
  onRegistered: () => Promise<void> | void
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `carico-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function CarichiView({ articles, recentCarichi, brandId, onRegistered }: CarichiViewProps) {
  const auth = useAuth()
  const [search, setSearch] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [quantity, setQuantity] = useState('')
  const [movementDate, setMovementDate] = useState(todayLocalIsoDate())
  const [supplier, setSupplier] = useState('')
  const [documentRef, setDocumentRef] = useState('')
  const [notes, setNotes] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey())
  const savingLockRef = useRef(false)

  const selectedArticle = useMemo(() => {
    if (!selectedCode) {
      return null
    }
    const key = selectedCode.toLowerCase()
    return articles.find((article) => article.code.trim().toLowerCase() === key) ?? null
  }, [articles, selectedCode])

  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) {
      return articles.slice(0, 12)
    }
    return articles
      .filter(
        (article) =>
          article.code.toLowerCase().includes(q) || article.description.toLowerCase().includes(q),
      )
      .slice(0, 20)
  }, [articles, search])

  const quantityParsed = parseQuantityInput(quantity)
  const previewStock =
    selectedArticle && quantityParsed.ok
      ? addQuantities(selectedArticle.currentStock, quantityParsed.value)
      : null

  const validationErrors = useMemo(() => {
    const errors: string[] = []
    if (!selectedArticle) {
      errors.push('Selezionare un articolo esistente dall’anagrafica.')
    }
    if (!quantityParsed.ok) {
      errors.push(quantityParsed.error)
    }
    if (!movementDate.trim()) {
      errors.push('La data del movimento è obbligatoria.')
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) {
      errors.push('La data del movimento non è valida.')
    }
    if (!supplier.trim()) {
      errors.push('Il fornitore è obbligatorio.')
    }
    if (!documentRef.trim()) {
      errors.push('Il riferimento documento è obbligatorio.')
    }
    return errors
  }, [selectedArticle, quantityParsed, movementDate, supplier, documentRef])

  const canPrepareConfirm = validationErrors.length === 0

  const resetFormAfterSuccess = () => {
    setQuantity('')
    setDocumentRef('')
    setNotes('')
    setShowConfirm(false)
    idempotencyKeyRef.current = createIdempotencyKey()
  }

  const handleSelectArticle = (article: ArticleRecord) => {
    setSelectedCode(article.code)
    setSearch(`${article.code} — ${article.description}`)
    setError(null)
    setSuccess(null)
    setShowConfirm(false)
    if (!supplier.trim() && article.supplier && article.supplier !== '—') {
      setSupplier(article.supplier)
    }
    idempotencyKeyRef.current = createIdempotencyKey()
  }

  const handlePrepareConfirm = () => {
    setError(null)
    setSuccess(null)
    if (!canPrepareConfirm) {
      setError(validationErrors[0] ?? 'Dati incompleti.')
      setShowConfirm(false)
      return
    }
    idempotencyKeyRef.current = createIdempotencyKey()
    setShowConfirm(true)
  }

  const handleConfirm = async () => {
    if (isSaving || savingLockRef.current) {
      return
    }
    if (!selectedArticle || !quantityParsed.ok) {
      setError('Dati non validi: impossibile confermare.')
      return
    }

    savingLockRef.current = true
    setIsSaving(true)
    setError(null)

    try {
      const result = await registerCarico(
        {
          articleCode: selectedArticle.code,
          quantity: quantityParsed.value,
          movementDate,
          supplier,
          documentRef,
          notes,
          idempotencyKey: idempotencyKeyRef.current,
        },
        brandId,
        movementActorFromAuth(auth.user, auth.profile),
      )

      await onRegistered()

      if (result.alreadyApplied) {
        setSuccess(
          `Carico già registrato in precedenza (idempotenza). Giacenza attuale: ${result.newStock}.`,
        )
      } else {
        setSuccess(
          `Carico registrato per ${result.movement.articleCode}: ${formatQuantity(result.movement.quantity)} (${result.previousStock} → ${result.newStock}).`,
        )
      }
      resetFormAfterSuccess()
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : 'Registrazione carico non riuscita.',
      )
    } finally {
      setIsSaving(false)
      savingLockRef.current = false
    }
  }

  return (
    <section className="carichi-page" aria-labelledby="carichi-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Movimenti</p>
        <h3 id="carichi-title">Carichi manuali</h3>
        <p className="section-heading__description">
          Registra un carico su un articolo esistente. La giacenza iniziale Excel resta invariata; viene
          aggiornata solo la giacenza operativa dopo conferma esplicita.
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

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Articolo</p>
          <h3>Selezione da anagrafica</h3>
        </div>

        <label className="field">
          <span className="field__label">Cerca per codice o descrizione</span>
          <input
            type="search"
            className="field__control"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setSelectedCode(null)
              setShowConfirm(false)
            }}
            placeholder="Es. MR011 oppure moschettone"
            autoComplete="off"
          />
        </label>

        <div className="table-wrap" aria-label="Risultati ricerca articoli">
          <table className="articles-table">
            <thead>
              <tr>
                <th scope="col">Codice</th>
                <th scope="col">Descrizione</th>
                <th scope="col">UdM</th>
                <th scope="col">Giacenza attuale</th>
                <th scope="col">Azione</th>
              </tr>
            </thead>
            <tbody>
              {articles.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <p className="empty-state__message">
                        Nessun articolo in anagrafica. Importa prima l&apos;Excel.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : filteredArticles.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <p className="empty-state__message">Nessun articolo corrisponde alla ricerca.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredArticles.map((article) => (
                  <tr
                    key={article.code}
                    className={
                      selectedCode?.toLowerCase() === article.code.toLowerCase()
                        ? 'articles-table__row--selected'
                        : undefined
                    }
                  >
                    <td>{article.code}</td>
                    <td>{article.description}</td>
                    <td>{article.unitOfMeasure}</td>
                    <td>{article.currentStock}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button secondary-button--compact"
                        onClick={() => handleSelectArticle(article)}
                      >
                        Seleziona
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {selectedArticle ? (
          <div className="empty-state" style={{ marginTop: '0.75rem' }}>
            <p className="empty-state__message">
              Selezionato: <strong>{selectedArticle.code}</strong> — {selectedArticle.description} · UdM{' '}
              {selectedArticle.unitOfMeasure} · Giacenza attuale <strong>{selectedArticle.currentStock}</strong>{' '}
              (iniziale Excel: {selectedArticle.stock})
            </p>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Dati del carico</p>
          <h3>Quantità e documento</h3>
        </div>

        <div className="mapping-grid">
          <label className="field">
            <span className="field__label">Quantità ricevuta *</span>
            <input
              type="text"
              inputMode="decimal"
              className="field__control"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value)
                setShowConfirm(false)
              }}
              placeholder="Es. 10 oppure 2,5"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Data del movimento *</span>
            <input
              type="date"
              className="field__control"
              value={movementDate}
              onChange={(event) => {
                setMovementDate(event.target.value)
                setShowConfirm(false)
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">Fornitore *</span>
            <input
              type="text"
              className="field__control"
              value={supplier}
              onChange={(event) => {
                setSupplier(event.target.value)
                setShowConfirm(false)
              }}
              placeholder="Ragione sociale fornitore"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Riferimento documento *</span>
            <input
              type="text"
              className="field__control"
              value={documentRef}
              onChange={(event) => {
                setDocumentRef(event.target.value)
                setShowConfirm(false)
              }}
              placeholder="Es. numero DDT"
              autoComplete="off"
            />
          </label>
        </div>

        <label className="field" style={{ marginTop: '1rem' }}>
          <span className="field__label">Note (facoltative)</span>
          <textarea
            className="field__control"
            rows={3}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value)
              setShowConfirm(false)
            }}
            placeholder="Annotazioni operative"
          />
        </label>

        {!canPrepareConfirm ? (
          <div className="alert alert--warning" role="status" style={{ marginTop: '1rem' }}>
            <p>Conferma non ancora disponibile:</p>
            <ul className="alert__list">
              {validationErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="import-wizard__actions" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="primary-button primary-button--cta"
            disabled={!canPrepareConfirm || isSaving}
            onClick={handlePrepareConfirm}
          >
            Prepara riepilogo
          </button>
        </div>
      </div>

      {showConfirm && selectedArticle && quantityParsed.ok && previewStock !== null ? (
        <div className="panel">
          <div className="section-heading">
            <p className="section-heading__eyebrow">Conferma</p>
            <h3>Riepilogo carico</h3>
          </div>

          <dl className="detail-grid">
            <div className="detail-field">
              <dt className="detail-field__label">Articolo</dt>
              <dd className="detail-field__value">
                {selectedArticle.code} — {selectedArticle.description}
              </dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Giacenza attuale</dt>
              <dd className="detail-field__value">{selectedArticle.currentStock}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Quantità da caricare</dt>
              <dd className="detail-field__value">{formatQuantity(quantityParsed.value)}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Giacenza prevista</dt>
              <dd className="detail-field__value">{previewStock}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Data movimento</dt>
              <dd className="detail-field__value">{formatLocalDateLabel(movementDate)}</dd>
            </div>
            <div className="detail-field">
              <dt className="detail-field__label">Fornitore / Documento</dt>
              <dd className="detail-field__value">
                {supplier.trim()} · {documentRef.trim()}
              </dd>
            </div>
          </dl>

          <p className="helper-text">
            Anteprima non ancora salvata. La giacenza iniziale Excel ({selectedArticle.stock}) non viene
            modificata.
          </p>

          <div className="import-wizard__actions">
            <button
              type="button"
              className="secondary-button"
              disabled={isSaving}
              onClick={() => setShowConfirm(false)}
            >
              Annulla
            </button>
            <button
              type="button"
              className="primary-button primary-button--cta"
              disabled={isSaving}
              onClick={() => {
                void handleConfirm()
              }}
            >
              {isSaving ? 'Salvataggio…' : 'Registra carico'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel" aria-labelledby="carichi-recenti-title">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Storico</p>
          <h3 id="carichi-recenti-title">Carichi recenti</h3>
        </div>
        <div className="table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Articolo</th>
                <th scope="col">Quantità</th>
                <th scope="col">Fornitore</th>
                <th scope="col">Documento</th>
              </tr>
            </thead>
            <tbody>
              {recentCarichi.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nessun movimento registrato.</td>
                </tr>
              ) : (
                recentCarichi.slice(0, 15).map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatLocalDateLabel(movement.movementDate)}</td>
                    <td>{movement.articleCode}</td>
                    <td>{formatQuantity(movement.quantity)}</td>
                    <td>{movement.supplier}</td>
                    <td>{movement.documentRef}</td>
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
