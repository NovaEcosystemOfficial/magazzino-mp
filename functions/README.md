# Cloud Functions — Magazzino MP (opzionale Blaze)

Il percorso **Spark di default** non richiede queste Functions: carichi/scarichi usano
`registerCloud*` + Security Rules. Vedi `docs/spark-senza-blaze.md`.

## Funzioni (solo se attivi Blaze)

| Nome | Ruolo |
|------|--------|
| `registerWarehouseMovement` | Percorso opzionale CARICO/SCARICO con Admin SDK (anti-tamper). |
| `importBrandSnapshot` | Migrazione/import admin opzionale via Admin SDK. |

Region: **europe-west1**.

## Attivazione Blaze (manuale — non eseguita da questa repo)

1. Piano **Blaze** su `magazzino-mp` (costi potenziali — non necessario per Spark)
2. Pubblicare rules compatibili (con Callable: deny client movement writes; oppure tenere Spark rules e non usare Callable)
3. `cd functions && npm install && npm run build`
4. Deploy Functions
5. Env frontend: `VITE_USE_STOCK_CALLABLE=true` oltre a cloud enabled
6. Redeploy Vercel

Per zero costi personali: lasciare `VITE_USE_STOCK_CALLABLE=false` e usare il percorso Spark.
