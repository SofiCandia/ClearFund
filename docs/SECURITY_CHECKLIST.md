# Checklist de seguridad del contrato

Revisión de código y pruebas existente para el prototipo Soroban de Testnet.
Esto no es una auditoría externa, no garantiza ausencia de vulnerabilidades y
no autoriza custodiar valor real. Referencia: [código del contrato](../contracts/donations/src/lib.rs)
y [pruebas del contrato](../contracts/donations/src/test.rs).

## Controles revisados

| Control                                                                   | Estado   | Evidencia / nota                                                                                                          |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Inicialización de una sola vez y autorización del admin                   | Revisado | `initialize` falla si ya hay admin y llama `require_auth`; test de autorización faltante.                                 |
| Autorización de organización al crear campaña y presentar evidencia       | Revisado | `create_campaign` y `submit_evidence` requieren auth de la organización.                                                  |
| Autorización de donante y verificador                                     | Revisado | `donate`/`claim_refund` requieren auth del donante; aprobación requiere auth del verificador.                             |
| Umbral M-de-N, verificadores únicos y separación organización/verificador | Revisado | Validaciones de creación y tests de umbral, doble voto y verificador inválido.                                            |
| Montos positivos, suma de objetivo y cálculo de reembolso checked         | Revisado | Se usan operaciones checked y errores explícitos de overflow.                                                             |
| Orden de hitos y no liberar dos veces                                     | Revisado | Solo evidencia de hito pendiente; se requiere liberar los anteriores; los tests cubren orden y doble liberación.          |
| Estado escrito antes de transferencias de token                           | Revisado | El helper de liberación y donación actualizan storage antes de invocar el token; Soroban ejecuta atómicamente la llamada. |
| Eventos requeridos y datos indexables                                     | Revisado | Eventos tipados para creación, donación, evidencia, aprobaciones, liberación, reembolso y estados terminales.             |
| TTL de storage persistente                                                | Revisado | Helpers extienden TTL de campañas, donaciones y marcadores; instance storage se extiende al leer/escribir count/campaign. |
| Pruebas locales de flujos negativos                                       | Revisado | `cargo test` cubre flujo feliz, umbral 2-de-3, autorización, reembolso, fechas y estados.                                 |
| IDs, datos de demo y claves                                               | Revisado | El seed no imprime semillas; `.env` está ignorado. Los importes del seed se mantienen por debajo del objetivo.            |

## Pendiente bloqueante

| Severidad          | Hallazgo                                                                                                                                                                                                                                                                            | Riesgo                                                                  | Recomendación                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALTO — abierto** | `donate` aumenta `total_raised` sin limitarlo a `goal`. La liberación marca `Completed` al llegar a `total_released == goal`; `claim_refund` rechaza campañas `Completed`. Si se recauda por encima del objetivo y se liberan todos los hitos, el excedente puede quedar bloqueado. | Pérdida de acceso a excedente de donantes en el contrato ya desplegado. | Antes de usar fondos de valor, rechazar aportes por encima de `goal - total_raised`, o implementar una política explícita de excedente/reembolso; añadir pruebas de exceso y desplegar una nueva versión revisada. La UI sola no es suficiente. |

El seed de Fase 6 mantiene sus aportes iguales o inferiores a cada meta para no
activar este caso; eso no corrige el comportamiento del contrato en Testnet.

## Limitaciones que requieren decisión

- Los reembolsos individuales usan división entera hacia abajo. El redondeo
  puede dejar residuos pequeños no reclamables; definir quién puede recuperar
  residuos o documentar el dust antes de producción.
- El primer reembolso marca la campaña `Expired`. Revisar la UX cuando varios
  donantes reclaman en diferentes transacciones y validar orden de reclamación
  y balance global con tests adicionales.
- El contrato recibe direcciones de contratos de token, pero no mantiene una
  allowlist de activos. Una campaña puede elegir cualquier contrato compatible;
  una futura política puede restringir emisores/SACs.
- El hash prueba integridad respecto del archivo presentado, no que la factura
  sea auténtica ni que el gasto sea elegible. La independencia del verificador,
  privacidad de documentos y proceso de disputa son operativos.
- Las garantías de TTL dependen de acceso/extensión y reglas de rent del
  protocolo; verificar campañas inactivas y persistencia antes de operar años.
- La atomicidad del host protege el rollback de transferencias fallidas, pero
  requiere volver a validar con la versión exacta del SDK/protocolo desplegada.

## Antes de una red principal

- [ ] Corregir y testear la sobre-recaudación en contrato; desplegar nueva
      dirección, verificar el WASM/hash y actualizar backend/bindings.
- [ ] Especificar y probar dust de reembolsos, expiración y campañas parciales.
- [ ] Auditar externamente contrato, autorización Soroban, storage/TTL y
      compatibilidad de tokens.
- [ ] Ejecutar fuzz/property tests para aritmética, secuencias de estados,
      reintentos RPC y concurrencia transaccional.
- [ ] Revisar SACs/issuers permitidos y comportamiento de tokens no estándar.
- [ ] Probar recuperación del indexer ante retención RPC insuficiente,
      reorg/checkpoint y restauración SQLite.
- [ ] Endurecer almacenamiento de evidencia, acceso, retención, backups y
      tratamiento de datos personales.
- [ ] Limitar relay/abuso, monitorizar cuotas y configurar CORS, logs y alertas.
- [ ] Completar revisión legal/compliance y preparar un plan de respuesta a
      incidentes y claves administrativas.

**Conclusión:** el código implementa controles básicos y pasa su suite de
pruebas, pero el pendiente de fondos sobre-recaudados hace que el contrato no
deba recibir fondos de valor. El despliegue actual es exclusivamente de demo
en Stellar Testnet.
