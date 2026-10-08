# Fase 0: Setup del monorepo y herramientas

## Qué se hizo

- Inicializado el workspace Rust de Soroban con `stellar contract init . --name donations`.
- Creada la estructura `contracts/donations`, `backend`, `packages/sdk`, `scripts` y `docs`.
- Actualizado el workspace Soroban a SDK 28, el major estable recomendado actualmente por la guía oficial de Stellar.
- Inicializado el workspace pnpm y el backend TypeScript con Fastify, Zod, Vitest, ESLint y Prettier.
- Añadidos `.gitignore`, `.env.example` documentado y un README inicial.
- Generada la identidad `clearfun-testnet` usando el almacén seguro de Windows y financiada en Testnet por Friendbot. La clave no se guardó en este repositorio.

## Herramientas verificadas

| Herramienta | Versión/estado |
| --- | --- |
| Rust (`rustc`) | 1.98.1 |
| Cargo | 1.98.1 |
| Target Rust | `wasm32v1-none` instalado |
| Stellar CLI | 28.0.0 |
| Node.js | v26.5.0 |
| pnpm | 12.10.1 |
| Docker | No instalado |

La [guía oficial de Soroban](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) requiere Rust 1.84 o superior y `wasm32v1-none`. La guía de proyecto usa `soroban-sdk = "28"`, por eso se actualizó el valor 27 incluido por la plantilla generada.

La documentación oficial indica Stellar CLI 28.1.0 como release estable más reciente; el CLI local 28.0.0 es funcional para esta fase. Para actualizarlo desde Rust:

```powershell
cargo install --locked stellar-cli@28.1.0
```

Para instalar Docker Desktop en Windows, sigue la [guía oficial de Docker](https://docs.docker.com/desktop/setup/install/windows-install/), inicia Docker Desktop y confirma con `docker --version`.

## Identidad Testnet

La identidad se creó en el almacén seguro de Windows, no en el repositorio. Comandos verificados:

```powershell
stellar keys generate clearfun-testnet --secure-store
stellar keys fund clearfun-testnet --network testnet
```

El segundo comando financia la cuenta a través de Friendbot. No imprimas ni compartas el secreto de esa identidad.

## Comandos de verificación

Ejecutados desde la raíz del monorepo:

| Comando | Resultado |
| --- | --- |
| `cargo build` | Correcto |
| `cargo test` | Correcto: 1 prueba |
| `pnpm install` | Correcto con pnpm 12.10.1 |
| `pnpm install --frozen-lockfile` | Correcto |
| `pnpm build` | Correcto: TypeScript compilado |
| `pnpm test` | Correcto: 2 pruebas |
| `pnpm lint` | Correcto |
| `pnpm format:check` | Correcto |

pnpm bloqueó inicialmente el script de instalación de `esbuild`. Se permitió únicamente ese paquete con `pnpm approve-builds esbuild`, requerido por `tsx`; otros scripts de dependencias no se habilitaron.

## Decisiones

- Se usó la plantilla oficial `stellar contract init` para preservar la estructura de workspace recomendada.
- Se eligió `wasm32v1-none` porque es el target actual documentado para contratos Soroban.
- El SDK se fijó en el major 28 de la documentación estable; `Cargo.lock` deja reproducibles las versiones resueltas.
- La clave testnet se guardó en Windows Secure Store y la financiación se hizo en Testnet, nunca mediante archivos del proyecto.
- Docker no está disponible en este equipo; su instalación queda documentada y no se afirma haber validado contenedores.
