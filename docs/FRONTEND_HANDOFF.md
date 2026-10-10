# Handoff de frontend ClearFund

La API Fastify expone `/docs` y `/docs/openapi.json`; el contrato nuevo no usa
verificadores ni aprobaciones. Antes de invocar la API, confirmar que el
backend está configurado con el `CONTRACT_ID` nuevo, no con
`LEGACY_CONTRACT_ID`.

## Endpoints y modelos

| Vista | Endpoint |
| --- | --- |
| Explorar campañas | `GET /campaigns?status=&page=&limit=&search=` |
| Detalle y hitos | `GET /campaigns/:id` |
| Posiciones de donantes | `GET /campaigns/:id/donations` |
| Actividad ordenada | `GET /campaigns/:id/timeline` |
| Historial de una wallet | `GET /donors/:address/donations` |
| Auditoría de campaña | `GET /campaigns/:id/audit` |
| Solvencia agregada por token | `GET /audit/solvency` |
| Crear campaña | `POST /tx/create-campaign` |
| Donar | `POST /tx/donate` |
| Subir y registrar evidencia | `POST /evidence/upload`, `POST /tx/submit-evidence` |
| Retirar la propia posición | `POST /tx/withdraw`; `/tx/claim-refund` es alias deprecado |
| Liberar hito públicamente | `POST /tx/release-milestone` |
| Recuperar garantía | `POST /tx/reclaim-bond` |
| Enviar XDR firmado | `POST /tx/submit` |

Los errores de API mantienen `{ error: { code, message } }`. Los montos son
cadenas decimales de unidades base; no convertir `i128` a `Number`. Los
eventos de timeline devuelven `tx_hash` y `explorer_url`.

## Habilitación de botones

Las reglas visuales no reemplazan la validación on-chain; las vistas pueden
estar retrasadas por indexación.

| Botón | Habilitar cuando |
| --- | --- |
| **Donar** | Campaña `Active`, hora actual anterior a `deadline`, wallet distinta de `org`, monto positivo y `max_donation >= monto`. El contrato valida de nuevo. |
| **Retirar mi parte** | `current_value > 0` y `withdrawable=true` en `/donations`. `true` significa ventana pública abierta o expiración sin una liberación pendiente. |
| **Subir evidencia** | Wallet conectada coincide con `org`; campaña `Active`; siguiente hito `Pending`; hitos anteriores `Released`; `held >= amount`; cabe la ventana completa antes del deadline. |
| **Liberar etapa** | Hito `EvidenceSubmitted`, `now >= window_end`, `held > 0`; acción pública, sin wallet verificadora ni contador de votos. |
| **Recuperar garantía** | Wallet coincide con `org`; deadline vencido; campaña no Completed; `total_shares == 0`; bond `Held`. El servidor prepara XDR mediante `/tx/reclaim-bond`. |

No mostrar acciones de aprobación, disputa o retiro global. Durante una ventana
abierta cada donante decide si salir. Al finalizar, el silencio no significa
rechazo: cualquiera puede ejecutar la liberación.

## Firmas y evidencia

1. Conectar Freighter u otra wallet compatible a Stellar Testnet.
2. Solicitar XDR sin firmar en el endpoint correspondiente (`signed:false`).
3. Firmar en la wallet y enviar el XDR firmado a `/tx/submit`. Nunca enviar
   claves privadas al backend.
4. Mostrar el hash y enlace de Stellar Expert recibido.
5. Para evidencia, enviar PDF/PNG/JPEG (máximo 10 MiB) a
   `/evidence/upload`, y luego su hash/URI con `POST /tx/submit-evidence`.

El endpoint `/tx/approve-milestone` se conserva únicamente como respuesta 410
`ENDPOINT_REMOVED`. No usarlo en el frontend.
