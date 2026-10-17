# Magazzino MP su Firebase Spark (zero Blaze)

## Dipendenze Callable (Blaze) nel codice

| Operazione | Callable (opzionale) | Percorso Spark (default) |
|------------|----------------------|---------------------------|
| CARICO / SCARICO / DDT | `registerWarehouseMovement` se `VITE_USE_STOCK_CALLABLE=true` | `registerCloud*` + `runTransaction` |
| Migrazione | `importBrandSnapshot` se flag true | batch client admin + reconcile |
| Login / profili | — | Auth + `users/{uid}` (Spark) |
| Letture sync | — | Firestore `onSnapshot` (Spark) |

Le Functions restano nel repo ma **non sono necessarie** per il percorso Spark.

## Cosa è ottenibile su Spark

- Multiutente con Auth + ruoli da Firestore (`users/{uid}`, write client deny).
- Tre brand isolati per path.
- Movimenti immutabili (update/delete deny).
- `performedByUid == auth.uid` (identità non falsificabile).
- Idempotenza (doc id = idempotencyKey).
- Scarichi concorrenti tra PC **onesti**: la transazione legge/scrive lo stesso `articles/{codeKey}`; Firestore ritenta il secondo writer → niente doppio scarico sullo stesso saldo.
- Giacenza negativa rifiutata **nell’app e nella transazione client** (non solo UI).

## Limiti di sicurezza residui

Le Security Rules **non** possono verificare “Σ movimenti ≥ scarico”. Un client malevolo autenticato come operator può tentare un `update` con `stockVersion+1` e `currentStock` inventato. Mitigazioni: solo utenti fidati; audit; eventuale backend Admin.

## Alternative gratuite per blocco malevolo (senza Blaze Firebase)

| Opzione | Costo | Note |
|---------|-------|------|
| **Vercel Serverless** (`/api/*`) + Firebase Admin | Hobby gratis | Stesso hosting del frontend; verifica ID token; transazione Admin. Consigliata se serve hard guarantee. |
| Cloudflare Workers + Admin | Free tier | Bundle Admin SDK pesante; più frizione. |
| Restare su Spark client-tx | €0 | Adeguato multi-PC aziendali fidati. |

**Scelta consigliata senza spese:** percorso Spark client-tx (già nel codice). Se in seguito serve anti-tamper: API Vercel gratuita, non Blaze.

## Attivazione cloud (manuale, zero Blaze)

1. Pubblicare `firestore.rules.cloud-warehouse.proposal`
2. Vercel: `VITE_CLOUD_WAREHOUSE_ENABLED=true`, `VITE_USE_STOCK_CALLABLE=false`, opz. `VITE_DATA_SOURCE=firestore`
3. Admin: backup + migrazione in Impostazioni (non automatica)
4. Switch sorgente Firestore
