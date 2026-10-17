# Fase 2A — Modello dati e architettura (specifica)

**Stato:** preparazione approvata. Nessuna migrazione, nessuna scrittura magazzino su Firestore, nessuna pubblicazione rules, nessuna attivazione Blaze.

**Sorgente dati attiva:** IndexedDB (`VITE_DATA_SOURCE` / runtime → `indexeddb`).

---

## 1. Isolamento obbligatorio per marca

Ogni marca ha un sottoalbero Firestore indipendente:

```text
brands/{brandId}/articles/{codeKey}
brands/{brandId}/movements/{movementId}
brands/{brandId}/meta/{docId}          # opzionale (schema, migrazione futura)
```

`brandId` ∈ `marina-raphael` | `elie-saab` | `swarovski` (allineato a `src/brands/brands.ts`).

- Nessuna collection condivisa tra marche.
- Nessuna query cross-brand.
- Path builder e rules rifiutano `brandId` non in elenco.

Profili utente restano in `users/{uid}` (già in uso per il login).

---

## 2. Documenti

### `users/{uid}` (già operativo)

| Campo | Tipo | Note |
|-------|------|------|
| `username` | string | Login tecnico |
| `displayName` | string | UI |
| `role` | `'admin'` \| `'operator'` | Solo Console / futuro backend |
| `active` | boolean | Account disattivabile |

Scrittura profilo: **mai** dal client (no self-elevate).

### `brands/{brandId}/articles/{codeKey}`

| Campo | Tipo | Note |
|-------|------|------|
| `code`, `codeKey` | string | `codeKey` = id documento |
| `description`, `unitOfMeasure`, `status`, `category`, `supplier`, `minStock` | string | Anagrafica |
| `stock` | string | Giacenza iniziale Excel — non alterabile da operator |
| `currentStock` | string | Cache UI; **non** verità assoluta |
| `totalReceived` | string | Storico Excel opzionale |
| `sourceFields` | map | Import |
| `updatedAt` | string ISO | Metadato |
| `updatedByUid` | string | = Auth UID |

### `brands/{brandId}/movements/{movementId}`

| Campo | Tipo | Note |
|-------|------|------|
| `id` | string | = id documento |
| `type` | `'CARICO'` \| `'SCARICO'` | |
| `articleId`, `articleCode` | string | |
| `quantity` | number | `> 0`, finito |
| `movementDate` | string | `YYYY-MM-DD` |
| `registeredAt` | string | ISO |
| `supplier`, `reason`, `documentRef`, `notes` | string | |
| `idempotencyKey` | string | Univoco per brand |
| `performedByUid` | string | **Obbligatorio** = `request.auth.uid` |
| `performedByUsername` | string | Solo display (non garanzia di identità) |

**Identità operatore:** solo `performedByUid` (Firebase Auth UID). Il username denormalizzato non è affidabile da solo.

**Immutabilità:** nessun `update` / `delete`, **neppure da admin**. Correzioni = movimenti compensativi (CARICO/SCARICO opposti) in fasi successive.

**Id documento / idempotenza:** preferire `movementId = idempotencyKey` così un secondo `create` sullo stesso path fallisce (anti-duplicato senza unique index aggiuntivo).

---

## 3. Verità di giacenza

Come IndexedDB oggi (`stockBalance.ts`):

```text
attuale = stock (iniziale) + Σ CARICO − Σ SCARICO
```

`currentStock` sul documento articolo è cache di visualizzazione.

### Giacenza non negativa — limite Spark / sole Rules

Le Firestore Security Rules **non** possono garantire in modo atomico e verificabile `giacenza ≥ 0` su tutto lo storico movimenti sotto carico concorrente multi-PC.

| Approccio | Garanzia multi-PC | Note |
|-----------|-------------------|------|
| Controlli solo client | **Non garantita** | Race tra due PC |
| Transazione client + versione cache | **Non garantita** al 100% | Mitiga, non elimina race sullo storico |
| Cloud Function / backend atomico | Verificabile | **Richiede Blaze** (o altro backend) |

**Fase 2A:** non si dichiara garantita la correttezza multi-PC. Prima di implementare una soluzione atomica server-side va segnalata e approvata (implica Blaze o backend esterno).

---

## 4. Accesso (bozza rules)

File bozza: `firestore.rules.cloud-warehouse.proposal`  
File rules **sicure per la fase login** (brands chiusi): `firestore.rules.proposal` — **non sostituire in publish** finché il magazzino cloud non è attivo.

| Path | Read | Write |
|------|------|-------|
| `users/{uid}` | self | deny |
| `brands/{brandId}/articles/**` | operator/admin attivi + brand valido | create/update con vincoli; delete deny |
| `brands/{brandId}/movements/**` | operator/admin attivi + brand valido | **solo create** con `performedByUid == auth.uid`; update/delete **deny per tutti** |
| `brands/{brandId}/meta/**` | admin | admin |
| altro | deny | deny |

Helper: `get(/users/$(request.auth.uid))` → `active` + `role`.

---

## 5. Feature flag

| Variabile | Valori | Runtime Fase 2A |
|-----------|--------|-----------------|
| `VITE_DATA_SOURCE` | `indexeddb` (default) \| `firestore` | Attivo solo `indexeddb` |

Modulo: `src/storage/dataSource.ts`  
`CLOUD_WAREHOUSE_ENABLED = false` → nessuna lettura/scrittura magazzino cloud.

---

## 6. Cosa non fa la Fase 2A

- Nessuna migrazione dati IndexedDB → Firestore
- Nessuna scrittura `brands/**` dall’app
- Nessuna modifica a carichi, scarichi, DDT, backup
- Nessun commit / push / deploy / upgrade Blaze
- Nessuna pubblicazione delle rules cloud-warehouse

## 6bis. Fase 2B (sola lettura codice)

Modulo: `src/cloud/warehouseRead.ts` (+ parse/errori).  
Test: `scripts/verify-fase-2b-warehouse-read.ts`.  
Con le **rules pubblicate** di fase login (`brands/**` deny) ogni lettura live fallisce con `permission-denied`. Non pubblicare la bozza cloud senza approvazione esplicita.

---

## 7. Test

Script: `scripts/verify-fase-2a-model.ts`

Copre: path isolati per marca, policy create-only movimenti (anche admin deny update/delete), `performedByUid` obbligatorio, flag IndexedDB attivo, asserzioni statiche sulla bozza rules, dichiarazione esplicita “stock ≥ 0 multi-PC non garantito senza backend atomico”.
