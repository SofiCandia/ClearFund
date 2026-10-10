# ClearFund

**Donaciones transparentes con salida individual, sin verificadores ni admin.**

ClearFund retiene fondos de campañas en un contrato Soroban de Stellar. La
organización publica evidencia por hitos y se abre una ventana pública; cada
donante puede retirar su propia participación. Al vencer la ventana, cualquier
cuenta puede liberar la etapa.

## Modelo de fondos

- Cada campaña contabiliza saldo retenido (`held`), participaciones
  (`total_shares`) y época. Los retiros son proporcionales al valor actual de
  las participaciones.
- La organización deposita una garantía calculada por BPS configurados una
  sola vez. Se devuelve al completar; tras abandono, puede añadirse al fondo
  de salida. No hay privilegios de administrador después de inicializar.
- El contrato impide superar la meta financiable (`ExceedsGoal`).
- No existen verificadores, votos, aprobaciones ni disputas.

**Limitaciones:** el silencio durante la ventana equivale a aceptar; una
evidencia falsa pero convincente puede engañar; la garantía no cubre una estafa
grande. ClearFund es un prototipo de Testnet, no una entidad financiera ni un
contrato auditado para fondos de valor.

## Red y contratos

- El identificador anterior se conserva en `.env` como
  `LEGACY_CONTRACT_ID`; campañas legacy no se mezclan con la indexación nueva.
- El `CONTRACT_ID` nuevo requiere despliegue Testnet. Si aún no se completó,
  permanece vacío y el indexer no conecta a la instancia legacy.
- XLM nativo usa un Stellar Asset Contract (SAC). No se debe presentar un
  activo de prueba como USDC oficial.
- Evidencia y transacciones en Testnet son públicas e irreversibles; no uses
  datos personales.

## Inicio rápido

Requisitos: Rust 1.84+, target `wasm32v1-none`, Stellar CLI, Node.js 20+ y pnpm.

```powershell
pnpm install --frozen-lockfile
cargo test
stellar contract build
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

Para trabajar con el backend local, define el `CONTRACT_ID` nuevo y los
endpoints en `.env`; `DATABASE_URL` usa por defecto una SQLite nueva para esta
versión:

```powershell
pnpm --filter @clearfun/backend dev
```

Swagger se sirve en `http://localhost:3000/docs`. El detalle de contrato,
despliegue e indexación está en [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Desplegar y probar en Testnet

Los scripts `scripts/deploy.ps1` y `scripts/deploy.sh` construyen WASM,
regeneran el SDK, despliegan el contrato nuevo e inicializan BPS=1000 con
autorización explícita. Preservan el ID anterior como `LEGACY_CONTRACT_ID`.
Se requiere `DEPLOYER_SECRET` financiado en Testnet; no imprimas ni compartas
el secreto.

Después de desplegar y configurar cuentas demo, se pueden ejecutar:

```powershell
pnpm --filter @clearfun/scripts smoke-test
pnpm --filter @clearfun/scripts seed
```

El smoke crea dos hitos, dos donantes, un retiro en ventana, dos liberaciones y
verifica la devolución de garantía. El seed crea una campaña completada, una
con ventana abierta y una recién creada; las ventanas son de 90 segundos.
Estos comandos hacen transacciones públicas reales en Testnet.

## Repositorio y documentos

```text
contracts/donations/  Contrato Soroban y pruebas
packages/sdk/         Bindings TypeScript regenerados del WASM
backend/              API Fastify, indexer y SQLite
scripts/              Deploy, smoke-test y seed
docs/                 API, seguridad, arquitectura y handoff
```

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): fondos, participaciones y
  límites de confianza.
- [`docs/CONTRACT_API.md`](docs/CONTRACT_API.md): métodos, errores y eventos.
- [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md): controles y
  pendientes preproducción.
- [`docs/FRONTEND_HANDOFF.md`](docs/FRONTEND_HANDOFF.md): endpoints y reglas de
  activación de botones.
- [`docs/BASE44_CHANGES.md`](docs/BASE44_CHANGES.md): cambios para Base44.
- [`docs/PROGRESS.md`](docs/PROGRESS.md): avance de esta migración.
