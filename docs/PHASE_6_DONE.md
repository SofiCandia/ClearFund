# Fase 6: seed, documentación final y pitch

## Qué se entregó

- `scripts/seed.ts` crea tres campañas nuevas por ejecución, hace aportes
  desde tres cuentas donantes distintas, presenta evidencia SHA-256, registra
  aprobaciones y lee el resultado final directamente del contrato.
- Se ejecutó el seed en Stellar Testnet: una campaña finalizó sus dos hitos,
  otra quedó con 50 % de la meta recaudada y una aprobación de dos, y una
  tercera quedó con 25 % recaudado.
- `README.md` final en español con resumen en inglés, diagrama Mermaid,
  arquitectura, pasos de inicio, contratos Testnet, mapa del repositorio y
  roadmap.
- Añadidos `docs/ARCHITECTURE.md`, `docs/PITCH_SCRIPT.md`,
  `docs/FRONTEND_HANDOFF.md` y `docs/SECURITY_CHECKLIST.md`.
- El checklist deja explícito un pendiente alto: se pueden recaudar fondos por
  encima de la meta y dejar excedentes bloqueados tras completar los hitos.
  No usar el contrato con fondos de valor antes de resolverlo.

## Campañas de demo en Testnet

Contrato: [ClearFun en Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI)

| ID  | Campaña                         |        Recaudado | Liberado | Estado                                        |
| --- | ------------------------------- | ---------------: | -------: | --------------------------------------------- |
| 2   | Agua potable para escuela rural |           15 XLM |   15 XLM | Completed                                     |
| 3   | Útiles escolares para 200 niños | 10 XLM de 20 XLM |    0 XLM | Active; primer hito con una aprobación de dos |
| 4   | Reconstrucción de sede vecinal  |  3 XLM de 12 XLM |    0 XLM | Active                                        |

Las cantidades se expresan en unidades base de XLM (10,000,000 stroops = 1
XLM). Las campañas anteriores no se sobrescriben: una ejecución posterior del
seed crea tres IDs nuevos.

Transacciones representativas:

| Acción                                      | Hash                                                               | Enlace                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Crear campaña 2                             | `6fc751de71d1829130ad154ce8cee45a260f11ee6e62e7afb37d3c7e00f91884` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/6fc751de71d1829130ad154ce8cee45a260f11ee6e62e7afb37d3c7e00f91884) |
| Completar y liberar los hitos de campaña 2  | `ba1488779c48791be1e62d43508222d120309d76be83cbcf2324541f03f58ac7` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/ba1488779c48791be1e62d43508222d120309d76be83cbcf2324541f03f58ac7) |
| Aprobar una vez el primer hito de campaña 3 | `a22275ba6843fb8465a971167b3015c81057cb976764d19cac4a005018e9e758` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/a22275ba6843fb8465a971167b3015c81057cb976764d19cac4a005018e9e758) |
| Crear campaña 4                             | `9a7cc9a38b674230961f190a0333d50445a0a0496d0c09addf3eb9177d7adc1e` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/9a7cc9a38b674230961f190a0333d50445a0a0496d0c09addf3eb9177d7adc1e) |

El URI de evidencia de este seed es una URL de ejemplo y el hash se calcula
sobre metadatos demo deterministas; no representa facturas reales. Para una
demo con archivos disponibles, carga evidencia real no sensible mediante
`POST /evidence/upload` y registra el hash/URI devueltos.

## Configuración y comando de seed

`.env.example` documenta los nombres requeridos. Configura en `.env` local
`CONTRACT_ID`, `TOKEN_XLM_ID` y las claves de organización, tres donantes y dos
verificadores. Las seis cuentas deben estar financiadas en Testnet. Para crear
cuentas, usa identidades cuyo secreto pueda leer el proceso local del SDK;
las claves encerradas en secure store pueden no ser exportables para el SDK.
Financia cada dirección pública de Testnet con Friendbot:

```powershell
$publicKey = "G...public-key-de-testnet"
Invoke-RestMethod -Uri "https://friendbot.stellar.org/?addr=$publicKey"
```

Guarda las semillas de las cuentas en un gestor de secretos o variables de
entorno del proceso; el SDK necesita acceso local para firmar los actores del
seed. No las copies a documentación ni las confirmes en Git.

Ejecuta desde la raíz:

```powershell
pnpm --filter @clearfun/scripts seed
```

El comando imprime IDs, resúmenes de estado y hashes/enlaces de transacciones,
nunca semillas secretas. Usa `SMOKE_ORG_SECRET` y las variables
`SMOKE_DONOR_SECRET`, `SMOKE_DONOR_2_SECRET`, `SMOKE_DONOR_3_SECRET`,
`SMOKE_VERIFIER_1_SECRET` y `SMOKE_VERIFIER_2_SECRET`.

## Verificación ejecutada

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm --filter @clearfun/scripts seed
cargo test --workspace
```

Instalación, builds, 13 pruebas Vitest, lint, Prettier y los 12 tests Rust
pasaron. El seed completó todas sus transacciones reales y verificó por RPC
los tres estados/cantidades listados arriba. Se generaron seis identidades
nuevas de Testnet y se financiaron con Friendbot; sus secretos permanecen solo
en el `.env` local ignorado por Git y no se mostraron ni agregaron al
repositorio.

Documentos entregados: [`README.md`](../README.md),
[`ARCHITECTURE.md`](./ARCHITECTURE.md), [`PITCH_SCRIPT.md`](./PITCH_SCRIPT.md),
[`FRONTEND_HANDOFF.md`](./FRONTEND_HANDOFF.md) y
[`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md).
