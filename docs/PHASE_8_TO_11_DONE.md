# Fases 8–11: salida individual del donante

## Resultado

| Dato | Valor | Estado |
| --- | --- | --- |
| Contrato nuevo | No desplegado; `CONTRACT_ID` permanece vacío | ⚠️ Pendiente de `DEPLOYER_SECRET` |
| Contrato previo | Conservado en `LEGACY_CONTRACT_ID`; no se usa como activo | ✅ Verificado en configuración local y Render |
| Contrato Soroban | Participaciones/épocas, ventanas de salida, garantía y liberación pública | ✅ `cargo test -p donations` (11/11) y `stellar contract build --package donations` |
| SDK | Bindings regenerados desde WASM y compilados | ✅ Build local |
| Backend/indexer | Eventos nuevos, endpoints de transacción, auditorías aisladas por campaña/token | ✅ Build y Vitest (15/15) |
| OpenAPI | `docs/openapi.json` regenerado desde el backend | ✅ Export local |
| Scripts | Deploy, smoke-test y seed listos | ✅ Build local; ejecución Testnet pendiente |
| ID nuevo y respuestas reales | No disponibles | ⚠️ Deploy bloqueado por cuenta deployer ausente |
| Transacciones smoke-test | Sin hashes ni links reales que registrar | ⚠️ Smoke-test Testnet pendiente |
| Claves Stellar en entregables | Sin coincidencias del patrón `S[A-Z2-7]{55}` | ✅ Búsqueda local |

## Alcance local verificado

- El contrato elimina las aprobaciones/verificadores; cada donante puede
  retirar su propia posición durante las reglas de salida públicas.
- Las etapas se liberan públicamente al terminar la ventana, y la garantía se
  devuelve, se retiene o se añade al fondo según el estado de la campaña.
- Backend e indexer usan una base SQLite nueva para no mezclar campañas legacy.
- Render ya no configura el contrato antiguo como activo ni reutiliza el nombre
  de la base SQLite anterior.
- La inicialización requiere `initializer` explícito además de `bond_bps` para
  poder aplicar `require_auth`; no queda administrador después de inicializar.

## Pendiente de operación

Configurar la cuenta deployer fuera del repositorio, desplegar e inicializar el
contrato en Testnet, copiar el ID resultante a la configuración de ejecución,
y entonces ejecutar smoke-test y seed. Hasta ese momento, los campos de
respuesta Base44 que dependen de RPC y los enlaces del explorer no pueden ser
reales; no se han inventado valores.
