# Cambios para conectar ClearFund en Base44

## Endpoints

- **Eliminado del flujo funcional:** `POST /tx/approve-milestone`; responde
  `410 ENDPOINT_REMOVED` con explicación en español.
- **Agregado:** `POST /tx/withdraw`, `POST /tx/release-milestone`,
  `POST /tx/reclaim-bond` y `GET /audit/solvency`.
- **Renombrado:** `/tx/claim-refund` se reemplaza por `/tx/withdraw`; el path
  anterior sigue como alias deprecado.
- **Se mantiene:** `/tx/submit-evidence`, `/tx/donate`,
  `/tx/create-campaign`, `/tx/submit`, lecturas, timeline y evidencia.
- Todas las rutas de transacción preparan XDR sin firmar; la wallet firma y
  envía el envelope firmado por `/tx/submit`.

## Campos por entidad

| Entidad | Eliminados | Agregados o vigentes |
| --- | --- | --- |
| Campaña | `verifiers`, `threshold`, `total_refunded`, `funds_held` | `bond_amount`, `bond_state`, `window_secs`, `held`, `total_withdrawn`, `funded=held+total_released`, `progress_percent` sobre `funded`, `max_donation=goal-funded`. Se mantienen `total_raised`, `total_released`, `goal`, `deadline`, `status`. |
| Hito | `approvals` | `window_end`, `released_amount`, `evidence_hash`, `evidence_uri`, `status`, `amount`. |
| Donación/posición | `refunded_amount` | `shares`, `current_value`, `withdrawn`, `withdrawable`; `amount` representa aportes indexados acumulados. |
| Evento de timeline | Tipos `milestone_approved` y `refund_claimed` | `exited`, `bond_returned`, `bond_slashed`, más eventos actuales `campaign_created`, `donated`, `evidence_submitted`, `milestone_released`, `campaign_completed`, `campaign_cancelled`. Cada evento lleva `tx_hash`, `explorer_url`, `payload`. |

## Etiquetas de eventos

| Evento | Etiqueta UI sugerida |
| --- | --- |
| `campaign_created` | Campaña creada |
| `donated` | Donación recibida |
| `evidence_submitted` | Evidencia publicada; ventana abierta |
| `exited` | Donante retiró su parte |
| `milestone_released` | Etapa liberada |
| `campaign_completed` | Campaña completada |
| `bond_returned` | Garantía devuelta |
| `bond_slashed` | Garantía añadida al fondo de salida |
| `campaign_cancelled` | Campaña cancelada |

## Reglas de botones

- **Donar:** `Active`, antes del deadline, la wallet no es `org`, monto positivo
  y menor o igual a `max_donation`.
- **Retirar mi parte:** `current_value > 0` y `withdrawable=true`. El retiro es
  de toda la posición; no hay selector de monto parcial.
- **Subir evidencia:** solo organización; campaña Active; siguiente hito
  Pending, anteriores Released, `held >= amount`, y la ventana cabe antes del
  deadline.
- **Liberar etapa:** evidencia en `EvidenceSubmitted`, `now >= window_end` y
  `held > 0`. Es una operación pública; no buscar ni mostrar verificadores.
- **Recuperar garantía:** organización conectada; deadline vencido; estado no
  Completed; `total_shares == 0`; `bond_state == Held`.

La ventana abierta permite la salida individual. El silencio equivale a
aceptar, una evidencia falsa convincente puede engañar y la garantía es
limitada; no hay admin, verificadores ni disputas.

## Conexión bloqueada hasta desplegar el contrato nuevo

El ID anterior debe quedar como `LEGACY_CONTRACT_ID`, nunca como contrato
activo del indexer de esta versión. El despliegue nuevo no pudo completarse
sin una cuenta deployer configurada; por ello `CONTRACT_ID`, respuestas
dinámicas del contrato y transacciones smoke-test reales permanecen pendientes.
No conectar Base44 a `localhost` ni sustituir un ID supuesto.
