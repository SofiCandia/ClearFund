# Handoff de frontend para ClearFun

El backend Fastify ya expone REST y OpenAPI. La especificación navegable está
en `/docs` y el JSON se sirve en `/docs/openapi.json`; el archivo versionado es
[`openapi.json`](./openapi.json). Construir el frontend queda fuera del alcance
de este monorepo.

## Pantallas sugeridas y endpoints

| Pantalla                       | Endpoints y datos                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explorar campañas              | `GET /campaigns?status=&page=&limit=&search=`. Mostrar título, estado, progreso, recaudado y meta.                                                                                   |
| Detalle de campaña             | `GET /campaigns/:id` para organización, token, verificadores, umbral, hitos, aprobaciones y fondos retenidos.                                                                        |
| Timeline de campaña            | `GET /campaigns/:id/timeline?page=&limit=`; cada fila da `tx_hash` y `explorer_url`.                                                                                                 |
| Donaciones de campaña          | `GET /campaigns/:id/donations?page=&limit=`. Mostrar montos como cadenas enteras; convertir/unidades solo con metadata precisa del token.                                            |
| Crear campaña                  | Conectar wallet para `source`/`org`; seleccionar token, título, URI, hitos, verificadores, threshold y deadline; preparar con `POST /tx/create-campaign`.                            |
| Panel de organización          | `GET /campaigns` y `GET /campaigns/:id`; enviar evidencia con `POST /evidence/upload`, y luego preparar `POST /tx/submit-evidence`. Refrescar timeline/detalle después de confirmar. |
| Panel de verificador           | `GET /campaigns/:id` para evidencia y estado; preparar `POST /tx/approve-milestone` y firmar con la wallet del verificador.                                                          |
| Vista de auditoría             | `GET /campaigns/:id/audit`, más `/campaigns/:id/timeline`; representar `consistent`, ingresos, egresos, saldo esperado y saldo on-chain.                                             |
| Perfil/historial de donante    | `GET /donors/:address/donations`.                                                                                                                                                    |
| Resumen global                 | `GET /stats`.                                                                                                                                                                        |
| Estado y documentación técnica | `GET /health`, `/docs`, `/docs/openapi.json`.                                                                                                                                        |

Todas las rutas comienzan en el origin de API configurado por ambiente. Leer
`explorer_url` devuelto en vez de construir rutas específicas del entorno.
El estado inicial del indexer puede tardar algunos segundos: una transacción
confirmada no implica que la proyección SQLite ya haya actualizado el detalle.

## Conectar wallet y firmar

1. Solicitar conexión a Freighter u otra wallet compatible. Tomar la dirección
   pública y verificar que la wallet usa Stellar Testnet, igual a la red del
   backend.
2. Construir el payload validado de la operación; importes de contrato son
   cadenas de enteros en unidades base. Para `source`, usar la dirección cuya
   firma de transacción corresponde a la invocación y respetar la autorización
   requerida: organización, donante o verificador.
3. Solicitar el XDR al endpoint de preparación correspondiente:
   `POST /tx/create-campaign`, `/tx/donate`, `/tx/submit-evidence`,
   `/tx/approve-milestone` o `/tx/claim-refund`. Respuesta:
   `{ "xdr": "...", "signed": false }`.
4. Entregar ese XDR a la wallet para firmarlo. La wallet conserva la clave
   privada y solicita consentimiento al usuario. Nunca enviar secretos al
   backend.
5. Enviar el envelope firmado al relayer:
   `POST /tx/submit` con `{ "xdr": "<signed XDR>" }`.
6. Mostrar el hash y usar el `explorer_url` de la respuesta. HTTP 200 significa
   confirmación `SUCCESS`; HTTP 202 indica `PENDING`, no rechazo. Para estado
   indexado, volver a consultar el endpoint de lectura correspondiente tras un
   breve intervalo.

Ejemplo conceptual de relay:

```http
POST /tx/submit
Content-Type: application/json

{"xdr":"<XDR firmado localmente por Freighter>"}
```

La API solo permite una operación Soroban dirigida al contrato configurado y
a uno de los métodos de escritura admitidos. La validación del envelope no
sustituye la validación y autorización del contrato.

## Evidencia

- Subir `multipart/form-data` con campo `file` a `POST /evidence/upload`;
  máximo 10 MiB y PDF/PNG/JPEG. Respuesta `{ hash, uri, content_type }`.
- Entregar `hash` y `uri` a `POST /tx/submit-evidence` (el índice de hito es
  base cero).
- Usar `GET /evidence/:hash` para descargar y `/evidence/:hash/verify` para
  recalcular SHA-256 y comprobar coincidencia con la evidencia indexada
  on-chain.
- El seed usa URI de ejemplo, no documentos probatorios reales. No presentar
  evidencia de demo como comprobante de gastos.

## UX y errores

- Enviar y tratar errores uniformes `{ "error": { "code", "message" } }`.
- Deshabilitar acciones incompatibles con los estados actuales, pero dejar que
  el contrato valide de nuevo al simular/ejecutar. No asumir que la validación
  del cliente es autoritativa.
- Mostrar importes con la unidad y precisión del token. Los valores API se
  conservan como cadenas para no perder precisión.
- Mostrar estados `Active`, `Completed`, `Expired`, `Cancelled` y de hito
  `Pending`, `EvidenceSubmitted`, `Released`.
- Para una campaña `Expired`, explicar que el reembolso se solicita por wallet
  con `POST /tx/claim-refund`, y actualizar el historial después de confirmar.
- Respetar rate limits y paginación. La API no pretende ser un stream en
  tiempo real; refrescar o hacer polling prudente.
