import { useRef, useState, type ChangeEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { movementActorFromAuth } from '../auth/movementActor'
import {
  migrateAllBrandsToFirestore,
  writeMigrationMeta,
  type MigrationReport,
} from '../cloud/migrateToFirestore'
import {
  assertValidMigrationBackup,
  createArticlesBackup,
  createLocalIndexedDbBackup,
  downloadBackupJson,
  getRestoreScope,
  parseBackupFile,
  restoreArticlesBackup,
} from '../storage/backup'
import {
  STOCK_ATOMICITY_STATUS,
  clearRuntimeDataSource,
  getActiveDataSource,
  getConfiguredDataSourcePreference,
  getRuntimeDataSource,
  isCloudWarehouseBuildEnabled,
  setRuntimeDataSource,
  type DataSource,
} from '../storage/dataSource'

type SettingsViewProps = {
  articleCount: number
  movementCount: number
  onArticlesReplaced: (count: number) => Promise<void> | void
  /** Riattiva lo splash senza cancellare i dati IndexedDB. */
  onReenableSplash?: () => void
  /** Dopo cambio sorgente IndexedDB ↔ Firestore. */
  onDataSourceChanged?: () => Promise<void> | void
}

export function SettingsView({
  articleCount,
  movementCount,
  onArticlesReplaced,
  onReenableSplash,
  onDataSourceChanged,
}: SettingsViewProps) {
  const auth = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [pendingRestoreCount, setPendingRestoreCount] = useState<number | null>(null)
  const [pendingMovementCount, setPendingMovementCount] = useState<number | null>(null)
  const [pendingRestorePayload, setPendingRestorePayload] = useState<unknown>(null)
  const [migrationReport, setMigrationReport] = useState<MigrationReport | null>(null)
  const [dataSourceTick, setDataSourceTick] = useState(0)

  const activeSource = getActiveDataSource()
  void dataSourceTick

  const handleExport = async () => {
    setIsBusy(true)
    setError(null)
    setMessage(null)

    try {
      const backup = await createArticlesBackup()
      downloadBackupJson(backup)
      setMessage(
        `Backup esportato: ${backup.meta.articleCount} articoli, ${backup.meta.movementCount} movimenti` +
          (backup.meta.brands?.length
            ? ` su ${backup.meta.brands.length} brand`
            : '') +
          ` (versione ${backup.version}, sorgente ${activeSource}).`,
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
      const scope = getRestoreScope(backup)
      setPendingRestorePayload(backup)
      setPendingRestoreCount(backup.meta.articleCount)
      setPendingMovementCount(backup.meta.movementCount)
      setMessage(
        `Backup valido del ${new Date(backup.exportedAt).toLocaleString('it-IT')}: ${backup.meta.articleCount} articoli, ${backup.meta.movementCount} movimenti (v${backup.version}). ${scope.overwriteWarning} Conferma per procedere. Il ripristino scrive su IndexedDB locale (non sul cloud).`,
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
        `Ripristino IndexedDB completato: ${result.articleCount} articoli e ${result.movementCount} movimenti` +
          (result.marinaRaphaelOnly
            ? ' (solo Marina Raphael).'
            : ` su ${result.brandsRestored.length} brand.`),
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

  const applyDataSource = async (source: DataSource) => {
    setIsBusy(true)
    setError(null)
    setMessage(null)
    try {
      setRuntimeDataSource(source)
      setDataSourceTick((n) => n + 1)
      await onDataSourceChanged?.()
      setMessage(
        source === 'firestore'
          ? 'Sorgente impostata su Firestore (cloud). Ricarica le viste e verifica le Security Rules pubblicate.'
          : 'Sorgente impostata su IndexedDB (locale). Il cloud non viene più usato da questa sessione.',
      )
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : 'Cambio sorgente dati non riuscito.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleMigrate = async () => {
    if (!auth.isAdmin) {
      setError('Solo un amministratore può avviare la migrazione verso Firestore.')
      return
    }
    const actor = movementActorFromAuth(auth.user, auth.profile)
    if (!actor) {
      setError('Utente non autenticato.')
      return
    }

    const confirmed = window.confirm(
      'Migrazione IndexedDB → Firestore (idempotente).\n\n' +
        '• Verrà creato un backup JSON locale prima della scrittura.\n' +
        '• Gli archivi IndexedDB NON verranno cancellati.\n' +
        '• Richiede Security Rules cloud già pubblicate.\n' +
        '• Non attiva automaticamente la modalità cloud.\n\n' +
        'Continuare?',
    )
    if (!confirmed) {
      return
    }

    setIsBusy(true)
    setError(null)
    setMessage(null)
    setMigrationReport(null)

    try {
      // Sempre IndexedDB locale + validazione strutturale: niente migrazione automatica/silente.
      const backup = assertValidMigrationBackup(await createLocalIndexedDbBackup())
      downloadBackupJson(backup)
      const report = await migrateAllBrandsToFirestore(actor)
      try {
        await writeMigrationMeta(report, actor)
      } catch {
        // meta richiede admin rules; non bloccare il report
      }
      setMigrationReport(report)
      setMessage(
        report.ok
          ? 'Migrazione completata e verificata. IndexedDB intatto. Per usare il cloud: abilita il build flag, pubblica le rules, poi seleziona sorgente Firestore.'
          : 'Migrazione terminata con differenze da verificare (vedi report sotto). IndexedDB intatto.',
      )
    } catch (migrateError) {
      setError(
        migrateError instanceof Error
          ? migrateError.message
          : 'Migrazione non riuscita. IndexedDB non è stato cancellato.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="settings-page" aria-labelledby="impostazioni-title">
      <div className="section-heading">
        <p className="section-heading__eyebrow">Archivio</p>
        <h3 id="impostazioni-title">Impostazioni</h3>
        <p className="section-heading__description">
          Sorgente attiva: <strong>{activeSource}</strong>. Articoli:{' '}
          <strong>{articleCount}</strong> · Movimenti: <strong>{movementCount}</strong>.
          Ruolo: <strong>{auth.role ?? '—'}</strong>.
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

      <div className="panel">
        <div className="section-heading">
          <p className="section-heading__eyebrow">Cloud</p>
          <h3>Sorgente dati</h3>
        </div>
        <p className="placeholder-text">
          Default sicuro: IndexedDB. Cloud Spark (senza Blaze):{' '}
          <code>VITE_CLOUD_WAREHOUSE_ENABLED=true</code>, rules pubblicate,{' '}
          <code>VITE_USE_STOCK_CALLABLE=false</code>. Carichi/scarichi usano transazioni
          Firestore client (PC onesti serializzati). Opzionale Blaze:{' '}
          <code>VITE_USE_STOCK_CALLABLE=true</code> + Function. Garanzia Admin anti-tamper:{' '}
          {STOCK_ATOMICITY_STATUS.serverEnforcedNonNegative
            ? 'attiva'
            : 'non attiva (serve Callable Blaze o API Admin gratuita esterna)'}.
        </p>
        <p className="placeholder-text">
          Build cloud: <strong>{isCloudWarehouseBuildEnabled() ? 'abilitata' : 'disabilitata'}</strong>
          {' · '}
          Env preferenza: <strong>{getConfiguredDataSourcePreference()}</strong>
          {' · '}
          Runtime: <strong>{getRuntimeDataSource() ?? 'nessuna'}</strong>
        </p>
        {auth.isAdmin && isCloudWarehouseBuildEnabled() ? (
          <div className="placeholder-actions">
            <button
              type="button"
              className="primary-button"
              disabled={isBusy || activeSource === 'firestore'}
              onClick={() => void applyDataSource('firestore')}
            >
              Usa Firestore (cloud)
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isBusy || activeSource === 'indexeddb'}
              onClick={() => void applyDataSource('indexeddb')}
            >
              Torna a IndexedDB
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isBusy}
              onClick={() => {
                clearRuntimeDataSource()
                setDataSourceTick((n) => n + 1)
                void onDataSourceChanged?.()
                setMessage('Preferenza runtime rimossa: vale VITE_DATA_SOURCE.')
              }}
            >
              Reset preferenza runtime
            </button>
          </div>
        ) : (
          <p className="placeholder-text">
            {auth.isAdmin
              ? 'Per abilitare il selettore: imposta VITE_CLOUD_WAREHOUSE_ENABLED=true su Vercel/.env.local e rideploy.'
              : 'Solo un amministratore può cambiare la sorgente dati.'}
          </p>
        )}
      </div>

      {auth.isAdmin ? (
        <div className="panel">
          <div className="section-heading">
            <p className="section-heading__eyebrow">Migrazione</p>
            <h3>IndexedDB → Firestore</h3>
          </div>
          <p className="placeholder-text">
            Operazione controllata e idempotente (admin). Percorso Spark: scritture client +
            riconciliazione giacenze. Opzionale Blaze: Callable{' '}
            <code>importBrandSnapshot</code> se <code>VITE_USE_STOCK_CALLABLE=true</code>.
            Backup preventivo locale; IndexedDB non cancellato; cloud non attivato
            automaticamente.
          </p>
          <div className="placeholder-actions">
            <button
              type="button"
              className="primary-button"
              disabled={isBusy}
              onClick={() => void handleMigrate()}
            >
              {isBusy ? 'Migrazione in corso…' : 'Avvia migrazione (admin)'}
            </button>
          </div>
          {migrationReport ? (
            <div className="placeholder-text" role="status">
              <p>
                Esito: <strong>{migrationReport.ok ? 'OK' : 'DA VERIFICARE'}</strong> ·{' '}
                {migrationReport.exportedAt}
              </p>
              <ul>
                {migrationReport.brands.map((b) => (
                  <li key={b.brandId}>
                    {b.brandId}: art {b.writtenArticles}/{b.localArticles} (skip{' '}
                    {b.skippedArticles}), mov {b.writtenMovements}/{b.localMovements} (skip{' '}
                    {b.skippedMovements}), cloud {b.cloudArticlesAfter}/{b.cloudMovementsAfter}
                    {b.stockMismatches.length > 0
                      ? ` — mismatch: ${b.stockMismatches.slice(0, 3).join('; ')}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
          Scarica un file JSON con formato <code>magazzino-mr-backup</code>, versione 3, con gli
          archivi di Marina Raphael, ELIE SAAB e Swarovski (articoli + movimenti). I backup v1/v2
          restano ripristinabili (solo Marina Raphael).
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
          Il file viene validato prima della scrittura. La conferma è obbligatoria. Il ripristino
          aggiorna IndexedDB locale (non sovrascrive Firestore).
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
