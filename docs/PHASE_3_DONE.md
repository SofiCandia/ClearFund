# Fase 3: Indexer Soroban en el backend

## Qué se hizo

- Añadida persistencia SQLite idempotente para `campaigns`, `milestones`,
  `donations`, `events` e `indexer_state`. Las cantidades se almacenan como
  texto decimal para preservar el rango completo de `i128`.
- Implementado un indexer con `getEvents` de Soroban RPC filtrado por el
  contrato configurado. Decodifica topics y payloads mediante `scValToNative`,
  conserva cada evento y su enlace de Stellar Expert, aplica proyecciones en
  orden de ledger/transacción/operación y checkpoint por bloque.
- La inserción del evento y sus proyecciones es una sola transacción SQLite.
  Un identificador de evento repetido no aplica dos veces los cambios.
- Los datos de campaña que no incluyen los eventos se completan y reconcilian
  mediante `queryContract("get_campaign")`.
- El backend activa el polling automáticamente si `CONTRACT_ID` está definido.
  El intervalo predeterminado es 5 segundos; fallos RPC se registran con Pino y
  se reintentan con backoff exponencial (máximo 60 segundos).
- Documentados el inicio, `INDEXER_START_LEDGER` y los límites de retención del
  RPC en [`DEPLOY.md`](./DEPLOY.md).

## Verificación local

Comandos ejecutados desde la raíz del monorepo:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

Resultados: todos correctos; backend Vitest ejecutó 6 pruebas (incluidas
idempotencia, orden cronológico, recuperación tras interrupción y evento sin
payload no indexado).

## Verificación real en Stellar Testnet

Se inició el backend con el `.env` local apuntando al contrato desplegado. El
servicio respondió `GET /health` con HTTP 200 y el indexer procesó eventos
desde la retención disponible del RPC. SQLite guardó el checkpoint hasta el
ledger `5076325` y el registro comprobado fue:

- Campaña `1`: `ClearFun testnet smoke campaign`, estado `Completed`,
  `total_raised=100000`, `total_released=100000`.
- Hito `0`: estado `Released`, monto `100000`, evidencia y dos aprobaciones.
- Donación: campaña `1`, donante de Testnet, `amount=100000`.
- Siete eventos persistidos: creación, donación, evidencia, dos aprobaciones,
  liberación y campaña completada. Cada fila conserva `tx_hash`, ledger,
  timestamp, payload JSON y `explorer_url`.

Campaña en Stellar Expert:
<https://stellar.expert/explorer/testnet/contract/CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI>

Transacción que libera el hito y completa la campaña:
<https://stellar.expert/explorer/testnet/tx/a4e4abb92f25d7e09f47e0d80a98a86d108a71c48e724f54cbbddac5223732cb>
