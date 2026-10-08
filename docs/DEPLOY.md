# Despliegue y smoke test en Stellar Testnet

## Requisitos y configuración

1. Instala Rust con `wasm32v1-none`, Stellar CLI, Node.js 20+ y pnpm.
2. Copia `.env.example` a `.env` y no compartas ni confirmes ese archivo.
3. Configura `DEPLOYER_SECRET` en tu gestor de secretos o en el entorno del
   proceso. Debe ser una cuenta financiada en Testnet. El script también carga
   valores no vacíos desde `.env`.

En PowerShell:

```powershell
Copy-Item .env.example .env
$env:DEPLOYER_SECRET = "SC...secret-de-testnet"
```

En Bash:

```bash
cp .env.example .env
export DEPLOYER_SECRET='SC...secret-de-testnet'
```

No incluyas una clave real en archivos versionados. `.env` está ignorado por
Git; `DEPLOYER_SECRET` también puede proveerse solo como variable del proceso.

## Compilar, desplegar e inicializar

En Windows:

```powershell
.\scripts\deploy.ps1
```

En Bash (Linux, macOS, Git Bash o WSL):

```bash
bash scripts/deploy.sh
```

Ambos scripts:

1. Construyen las bindings y ejecutan `stellar contract build` (la CLI optimiza
   el WASM).
2. Despliegan `target/wasm32v1-none/release/donations.wasm` en Testnet y crean
   el alias local `clearfun-donations`.
3. Inicializan el contrato usando la dirección pública derivada de
   `DEPLOYER_SECRET`.
4. Actualizan únicamente `CONTRACT_ID` en `.env`; no escriben la clave secreta.

El comando de despliegue imprime el hash/link del upload y del despliegue. El
contrato se puede consultar con `https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>`.

## Stellar Asset Contracts: XLM y USDC de prueba

En Windows:

```powershell
.\scripts\setup-tokens.ps1
```

En Bash:

```bash
bash scripts/setup-tokens.sh
```

El script calcula el ID del SAC nativo XLM y consulta `name` en Testnet. Si ya
existe, lo reutiliza; si no, intenta desplegarlo. Guarda `TOKEN_XLM_ID` en
`.env`. En la Testnet usada para esta fase, el SAC nativo ya está desplegado.

### Crear y emitir un activo de prueba `USDC`

Un activo clásico necesita un issuer y trustlines para cuentas receptoras.
Estos comandos crean un issuer local del CLI, crean la trustline de la cuenta
`clearfun-testnet` y emiten 10 unidades USDC (100,000,000 stroops, dado que los
activos usan siete decimales):

```powershell
stellar keys generate clearfun-usdc-issuer --secure-store
stellar keys fund clearfun-usdc-issuer --network testnet
stellar tx new change-trust --source-account clearfun-testnet --network testnet --line USDC:clearfun-usdc-issuer
stellar tx new payment --source-account clearfun-usdc-issuer --network testnet --destination clearfun-testnet --asset USDC:clearfun-usdc-issuer --amount 100000000
$env:USDC_ISSUER_ADDRESS = (stellar keys public-key clearfun-usdc-issuer)
stellar contract asset deploy --source-account clearfun-testnet --network testnet --asset "USDC:$env:USDC_ISSUER_ADDRESS"
.\scripts\setup-tokens.ps1
```

`USDC` aquí es un activo de prueba emitido por el issuer local, no el USDC
oficial de Circle. Para la variante Bash, exporta la dirección pública del
issuer y ejecuta el script de configuración:

```bash
stellar keys generate clearfun-usdc-issuer --secure-store
stellar keys fund clearfun-usdc-issuer --network testnet
stellar tx new change-trust --source-account clearfun-testnet --network testnet --line USDC:clearfun-usdc-issuer
stellar tx new payment --source-account clearfun-usdc-issuer --network testnet --destination clearfun-testnet --asset USDC:clearfun-usdc-issuer --amount 100000000
export USDC_ISSUER_ADDRESS="$(stellar keys public-key clearfun-usdc-issuer)"
stellar contract asset deploy --source-account clearfun-testnet --network testnet --asset "USDC:$USDC_ISSUER_ADDRESS"
bash scripts/setup-tokens.sh
```

`setup-tokens` deriva y valida el ID del SAC `USDC:<issuer>`, lo despliega si
no responde y persiste `TOKEN_USDC_ID`. El emisor puede necesitar habilitar la
trustline de cada cuenta receptora antes de emitir o transferir el activo.

## Generar el paquete de bindings

Desde la raíz, con el WASM compilado:

```powershell
stellar contract bindings typescript --wasm target\wasm32v1-none\release\donations.wasm --output-dir packages\sdk --overwrite
pnpm install
pnpm --filter @clearfun/sdk build
```

La plantilla generada por Stellar CLI reemplaza `packages/sdk/package.json` y
`tsconfig.json`; después de regenerar, restaura el nombre `@clearfun/sdk` y la
configuración workspace tipada. Luego compila el monorepo:

```powershell
pnpm build
```

## Ejecutar el smoke test real de Testnet

El smoke test usa el SDK generado y requiere cuentas distintas para admin,
organización, donante y los dos verificadores. Financia cinco cuentas en
Testnet antes de ejecutarlo. Proporciona sus claves al proceso desde un gestor
de secretos o desde el entorno temporal de la terminal; no las agregues a Git.
Secure Store no permite extraer las claves necesarias para el firmante local
del SDK.

Las variables requeridas son:

```text
DEPLOYER_SECRET
SMOKE_ORG_SECRET
SMOKE_DONOR_SECRET
SMOKE_VERIFIER_1_SECRET
SMOKE_VERIFIER_2_SECRET
```

`CONTRACT_ID` y `TOKEN_XLM_ID` se leen desde `.env`. Configura las cinco
variables secretas en el entorno del proceso o en `.env` local protegido. Si
tu gestor de secretos ya las proporciona al proceso, ejecuta:

```powershell
pnpm --filter @clearfun/scripts smoke-test
```

El script crea una campaña nueva de Testnet con un hito, dona XLM, registra un
SHA-256 de evidencia, aprueba con dos verificadores y comprueba en el SAC que
la organización recibió exactamente el monto liberado. Imprime el hash y enlace
de Stellar Expert de cada transacción.

## Ejecutar el indexer Soroban

El backend inicia el indexer automáticamente cuando `.env` tiene un
`CONTRACT_ID` no vacío. El índice usa SQLite en `DATABASE_URL` y crea sus
tablas si todavía no existen. La configuración del polling es:

```text
INDEXER_POLL_INTERVAL_MS=5000
INDEXER_START_LEDGER=0
```

Con `INDEXER_START_LEDGER=0`, el primer arranque consulta el ledger más antiguo
que retenga el RPC y avanza en bloques; para limitar el backfill, configura un
ledger explícito, por ejemplo el del despliegue del contrato. Stellar RPC
mantiene una ventana de retención acotada: si el proceso cae tanto tiempo que
el ledger guardado queda fuera de esa ventana, el indexer registra el error y
reintenta sin saltarse eventos. Para recuperar ese caso se necesita un RPC con
retención/archive apropiada o un reinicio explícito con un punto inicial
disponible.

Inicia el backend desde la raíz del monorepo:

```powershell
pnpm --filter @clearfun/backend build
pnpm --filter @clearfun/backend start
```

El proceso consulta `getEvents`, persiste los eventos crudos y los proyecta a
`campaigns`, `milestones` y `donations`. El identificador estable del evento es
la clave primaria; escritura del evento y sus proyecciones es transaccional.
Después de cada bloque consulta `get_campaign` para completar campos que no
están en los eventos y reconciliar el estado actual. Pino registra el avance y
los reintentos con backoff.

## Direcciones verificadas durante Fase 2

- Contrato: `CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI`
- SAC XLM nativo: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

`docs/PHASE_2_DONE.md` registra los hashes y enlaces de las transacciones
reales desplegadas y del smoke test.
