import { useRef, useState, type ChangeEvent } from 'react'
import {
  createArticlesBackup,
  downloadBackupJson,
  parseBackupFile,
  restoreArticlesBackup,
} from '../storage/backup'

type SettingsViewProps = {
  articleCount: number
  movementCount: number
  onArticlesReplaced: (count: number) => Promise<void> | void
  /** Riattiva lo splash senza cancellare i dati IndexedDB. */
  onReenableSplash?: () => void
}

export function SettingsView({
  articleCount,
  movementCount,
  onArticlesReplaced,
  onReenableSplash,
}: SettingsViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [pendingRestoreCount, setPendingRestoreCount] = useState<number | null>(null)
  const [pendingMovementCount, setPendingMovementCount] = useState<number | null>(null)
  const [pendingRestorePayload, setPendingRestorePayload] = useState<unknown>(null)

  const handleExport = async () => {
    setIsBusy(true)
    setError(null)
    setMessage(null)

    try {
      const backup = await createArticlesBackup()
      downloadBackupJson(backup)
      setMessage(
        `Backup esportato: ${backup.meta.articleCount} articoli, ${backup.meta.movementCount} movimenti (versione ${backup.version}).`,
      )
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Esportazione backup non riuscita.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    setIsBusy(true)
    setError(null)
    setMessage(null)
    setPendingRestoreCount(null)
    setPendingMovementCount(null)
    setPendingRestorePayload(null)

    try {
      const backup = await parseBackupFile(file)
      setPendingRestorePayload(backup)
      setPendingRestoreCount(backup.articles.length)
      setPendingMovementCount(backup.movements.length)
      setMessage(
        `Backup valido del ${new Date(backup.exportedAt).toLocaleString('it-IT')}: ${backup.articles.length} articoli, ${backup.movements.length} movimenti (v${backup.version}). Conferma per sostituire l’archivio attuale.`,
      )
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : 'Il file di backup non è valido.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleConfirmRestore = async () => {
    if (pendingRestorePayload == null) {
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const result = await restoreArticlesBackup(pendingRestorePayload)
      await onArticlesReplaced(result.articleCount)
      setPendingRestorePayload(null)
      setPendingRestoreCount(null)
      setPendingMovementCount(null)
      setMessage(
        `Ripristino completato: ${result.articleCount} articoli e ${result.movementCount} movimenti salvati in IndexedDB.`,
      )
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : 'Ripristino non riuscito: i dati esistenti non sono stati sostituiti.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="settings-page" aria-labelledby="impostazioni-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Archivio locale</p>
        <h3 id="impostazioni-title">Impostazioni</h3>
        <p className="section-heading__description">
          Backup e ripristino di anagrafica e movimenti salvati in IndexedDB. Articoli:{' '}
          <strong>{articleCount}</strong> · Movimenti: <strong>{movementCount}</strong>.
        </p>
      </div>

      {error ? (
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {message ? (
        <div className="alert alert--success" role="status">
          <p>{message}</p>
        </div>
      ) : null}

      {onReenableSplash ? (
        <div className="panel">
          <div className="section-heading">
            <p className="section-heading__eyebrow">Schermata iniziale</p>
            <h3>Splash screen</h3>
          </div>
          <p className="placeholder-text">
            Per i test: mostra di nuovo lo splash al prossimo ingresso. Non cancella articoli,
            movimenti o backup. Agisce solo sulla preferenza del browser (localStorage).
          </p>
          <div className="placeholder-actions">
            <button type="button" className="secondary-button" onClick={onReenableSplash}>
              Mostra splash screen
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Backup</p>
          <h3>Esporta JSON versionato</h3>
        </div>
        <p className="placeholder-text">
          Scarica un file JSON con formato <code>magazzino-mr-backup</code>, versione 2, metadati,
          anagrafica e movimenti (carichi/scarichi). I backup v1 restano ripristinabili.
        </p>
        <div className="placeholder-actions">
          <button type="button" className="primary-button" onClick={() => void handleExport()} disabled={isBusy}>
            {isBusy ? 'Operazione in corso…' : 'Esporta backup JSON'}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Ripristino</p>
          <h3>Ripristina da backup</h3>
        </div>
        <p className="placeholder-text">
          Il file viene validato prima della scrittura. La sostituzione dell&apos;archivio richiede
          conferma esplicita e avviene solo se IndexedDB completa la transazione.
        </p>
        <div className="placeholder-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
          >
            Seleziona file backup
          </button>
          {pendingRestoreCount != null ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleConfirmRestore()}
              disabled={isBusy}
            >
              Conferma ripristino ({pendingRestoreCount} articoli
              {pendingMovementCount != null ? `, ${pendingMovementCount} movimenti` : ''})
            </button>
          ) : null}
          {pendingRestoreCount != null ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPendingRestoreCount(null)
                setPendingMovementCount(null)
                setPendingRestorePayload(null)
                setMessage(null)
              }}
              disabled={isBusy}
            >
              Annulla ripristino
            </button>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(event) => {
            void handleRestoreFile(event)
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </section>
  )
}
