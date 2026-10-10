# Despliegue y operación Testnet

## Antes del despliegue

- Rust 1.84+, target `wasm32v1-none`, Stellar CLI, Node.js 20+ y pnpm.
- Una cuenta deployer financiada con XLM de Testnet.
- Cuenta org y dos cuentas donantes financiadas para smoke/seed.
- `.env` local ignorado por Git. Nunca imprimir o pegar sus secretos.

El `.env` actual conserva el contrato previo en `LEGACY_CONTRACT_ID` y deja
`CONTRACT_ID` vacío mientras no se confirme un nuevo despliegue. El indexer usa
una SQLite nueva (`./data/clearfun-v2.db`) y `CONTRACT_ID` como único filtro;
las campañas 1–4 del contrato anterior no entran en esta base.

## Build, bindings y deploy

Los dos scripts ejecutan `stellar contract build`, regeneran las bindings
TypeScript desde el WASM y compilan SDK/scripts, despliegan un contrato nuevo y
ejecutan `initialize` con `bond_bps=1000` y la dirección autenticada derivada
de `DEPLOYER_SECRET`.

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
```

Bash:

```bash
bash scripts/deploy.sh
```

El script coloca el `CONTRACT_ID` nuevo en `.env`; el valor anterior queda como
`LEGACY_CONTRACT_ID`. La identidad del initializer no obtiene permisos
posteriores. Si el proceso falla antes de la actualización de `.env`, no
consideres el despliegue completo: verifica el ID y la inicialización en
Stellar Expert antes de reintentar.

Bindings manuales:

```powershell
stellar contract build --package donations
stellar contract bindings typescript --wasm target\wasm32v1-none\release\donations.wasm --output-dir packages\sdk --overwrite
pnpm --filter @clearfun/sdk build
pnpm --filter @clearfun/scripts build
```

## Pruebas

```powershell
cargo test -p donations
stellar contract build --package donations
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

El smoke-test usa `CONTRACT_ID`, `TOKEN_XLM_ID`,
`DEPLOYER_SECRET`, `SMOKE_ORG_SECRET`, `SMOKE_DONOR_SECRET` y
`SMOKE_DONOR_2_SECRET`. Crea dos hitos de 100.000 stroops, abre ventanas de
60 segundos, permite la salida de un donante y prueba ambas liberaciones y la
garantía. Imprime hashes y links de Stellar Expert, nunca secretos.

```powershell
pnpm --filter @clearfun/scripts smoke-test
```

El seed necesita `SMOKE_ORG_SECRET`, `SMOKE_DONOR_SECRET`,
`SMOKE_DONOR_2_SECRET` y `SMOKE_DONOR_3_SECRET`. Crea tres campañas con ventana
de 90 segundos: una completada tras salida individual, una mitad financiada
con ventana abierta y una recién creada.

```powershell
pnpm --filter @clearfun/scripts seed
```

Seed y smoke generan transacciones públicas, gastan fees/tokens y no son
idempotentes en el sentido de crear un mismo ID; cada ejecución crea campañas
nuevas.

## API e indexer

Configura `CONTRACT_ID` con el ID nuevo, `NETWORK_PASSPHRASE`,
`SOROBAN_RPC_URL` y una ruta nueva `DATABASE_URL`. La API inicia el indexer solo
si hay un `CONTRACT_ID` no vacío. No uses el ID legacy como valor activo.

```powershell
pnpm --filter @clearfun/backend dev
```

El indexer filtra eventos por contrato y deduplica cada evento mediante su ID
RPC. Después de cada rango, sincroniza `get_campaign`; las posiciones
individuales se consultan mediante `get_position` cuando el índice detecta una
época antigua. Un cursor fuera de la retención RPC requiere un endpoint archive
o recuperación operativa; no se salta eventos silenciosamente.

Despliegue público del backend, CORS y almacenamiento persistente requieren
configuración adicional. No usar `ALLOWED_ORIGINS=*` en producción. Swagger se
publica en `/docs`, OpenAPI JSON en `/docs/openapi.json`.

## Estado del despliegue nuevo

El ID previo se preservó localmente como legacy. El deploy nuevo y smoke real
están pendientes si no se dispone de `DEPLOYER_SECRET` financiado. No se debe
presentar un hash, ID de contrato, respuesta RPC o enlace de transacción
supuesto como verificado. Actualiza `docs/PROGRESS.md` y
`docs/PHASE_8_TO_11_DONE.md` con los valores reales al terminar la operación.
