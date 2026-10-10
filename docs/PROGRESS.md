# Progreso: salida individual del donante

## Completado localmente

- ✅ Contrato reescrito con posiciones por participaciones/época, garantía,
  ventana pública, nueve eventos y errores estables.
- ✅ Pruebas del contrato: `cargo test -p donations` (11/11).
- ✅ WASM creado con `stellar contract build --package donations`.
- ✅ `initialize` autentica una dirección explícita, configura una sola vez y
  no deja privilegios administrativos posteriores.
- ✅ SDK TypeScript regenerado desde el WASM y compilado.
- ✅ Scripts de deploy configurados para el contrato nuevo y `bond_bps=1000`.
- ✅ Smoke-test y seed escritos y compilados.
- ✅ Backend migrado: base nueva, indexer idempotente, endpoints, auditoría de
  campaña y solvencia por token.
- ✅ Backend: build, 15/15 tests Vitest, lint, formato y OpenAPI exportado.
- ✅ Documentación del protocolo y conexión Base44 actualizada.
- ✅ Configuración Render ya no apunta al ID legacy ni a su base SQLite; el
  contrato activo queda vacío hasta desplegar el nuevo.
- ✅ Búsqueda final del patrón de claves Stellar: sin coincidencias en los
  entregables.
- ✅ Resumen final creado en `PHASE_8_TO_11_DONE.md`.

## Pendiente externo

- ⏳ Deploy e inicialización reales en Testnet.
- ⏳ Actualizar `CONTRACT_ID` de `.env`, Render y materiales Base44 con el ID
  real nuevo.
- ⏳ Ejecutar smoke-test y seed reales y registrar hashes/enlaces del explorer.
- ⏳ Validar respuestas RPC reales de los endpoints.

La cuenta deployer no está configurada (`DEPLOYER_SECRET` ausente). No se
inventaron identificadores, resultados RPC ni transacciones. El ID anterior y
los datos antiguos se conservan como legacy.

## Decisión de autenticación

La firma implementada es `initialize(bond_bps, initializer)`: requiere
`initializer.require_auth()` porque la API solicitada de un único argumento no
incluye una identidad que Soroban pueda autenticar. Se conserva la garantía de
que no hay privilegios posteriores; no se añadió una API del SDK supuesta.
