# ClearFun × Base44 — paquete de conexión

**Estado:** Fase 7 de conexión. Todos los endpoints se sirven desde la URL
pública del backend una vez que el Blueprint de Render se despliegue. La URL
pública y los dominios de la app Base44 aún no están configurados; no uses
`localhost` en Base44. Los ejemplos de respuesta marcados “real” se obtuvieron
de una instancia local temporal del backend conectado a Testnet y a la SQLite
sincronizada. Esa instancia local no es una URL que Base44 pueda usar.

## 1. Identidad de red y contrato

| Dato                       | Valor verificado                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Red                        | Stellar Testnet (`testnet`)                                                                                                                                      |
| `NETWORK_PASSPHRASE`       | `Test SDF Network ; September 2015`                                                                                                                              |
| `SOROBAN_RPC_URL`          | `https://soroban-testnet.stellar.org`                                                                                                                            |
| `HORIZON_URL`              | `https://horizon-testnet.stellar.org`                                                                                                                            |
| `CONTRACT_ID`              | `CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI`                                                                                                       |
| Contrato en Stellar Expert | https://stellar.expert/explorer/testnet/contract/CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI                                                        |
| Deploy del contrato        | Hash `12d997f0981a847dc45cedc563df7119303b0dc394399692572f401d0eeb2ad8`; Horizon verificó éxito, ledger 5076097, `2026-10-07T20:14:32Z` (16:14:32 hora `-04:00`) |
| Transacción de deploy      | https://stellar.expert/explorer/testnet/tx/12d997f0981a847dc45cedc563df7119303b0dc394399692572f401d0eeb2ad8                                                      |
| `TOKEN_XLM_ID`             | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`                                                                                                       |
| Token XLM                  | Stellar Asset Contract del activo nativo: `name=native`, `symbol=native`, `decimals=7`; verificado por lectura Soroban RPC Testnet                               |
| `TOKEN_USDC_ID`            | **PENDIENTE:** vacío en `.env`; no se desplegó SAC de USDC de prueba                                                                                             |
| Emisor/código USDC         | **PENDIENTE:** no hay `USDC_ISSUER_ADDRESS`; todavía no existe un issuer/asset de prueba configurado                                                             |

### Conversión de cantidades

El contrato almacena cantidades como enteros `i128` en unidades mínimas. XLM
usa 7 decimales: `1 XLM = 10,000,000 stroops`. Para el USDC de prueba,
7 decimales es la precisión de los activos Stellar clásicos, pero el token no
existe todavía en esta instalación; al desplegarlo, confirma de nuevo el
`decimals()` del SAC antes de permitirlo.

```js
function toBaseUnits(displayAmount, decimals = 7) {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals debe ser un entero no negativo");
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(String(displayAmount));
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new Error("Importe decimal inválido o con demasiados decimales");
  }
  const [whole, fraction = ""] = String(displayAmount).split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

function fromBaseUnits(baseUnits, decimals = 7) {
  const value = BigInt(baseUnits);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

toBaseUnits("1.25"); // 12500000n stroops
fromBaseUnits("12500000"); // "1.25" XLM
```

No conviertas `i128` con `Number`; usa cadenas y `BigInt`. La API espera las
cantidades de transacción como cadenas decimales de unidades mínimas.

## 2. URL pública del backend — pendiente de despliegue

**`API_BASE_URL`: PENDIENTE.** No se encontró una URL pública en `render.yaml` ni
en la documentación; `render.yaml` declara un Blueprint llamado
`clearfun-backend`, no un hostname. El directorio de trabajo tampoco es un
repositorio Git conectado a un proveedor. No existe endpoint público verificado,
por tanto no se puede ejecutar `curl <URL pública>/health`. La instancia de
validación de esta fase fue Node local temporal, no Docker (Docker no está
instalado); Base44 no puede acceder a ella.

### Publicar en Render

1. Publica/sube el monorepo a un repositorio Git privado o público que Render
   pueda conectar. No incluyas `.env`.
2. En Render, crea **New + → Blueprint** y selecciona el repositorio. Revisa
   que detecte `render.yaml`; confirma el servicio `clearfun-backend`.
3. En la creación del servicio, asigna `CONTRACT_ID` al contrato Testnet
   indicado arriba. El Blueprint define Testnet, `PORT=10000`, el disco
   persistente `/app/data`, SQLite y evidencias.
4. Una vez desplegado, copia el hostname HTTPS exacto que Render muestre en el
   dashboard; ese valor será `API_BASE_URL`. Verifica:

   ```sh
   curl -i "https://<hostname-asignado-por-render>/health"
   curl -i "https://<hostname-asignado-por-render>/docs/openapi.json"
   ```

   No sustituyas el hostname por uno supuesto. Swagger estará en
   `https://<hostname-asignado-por-render>/docs`.

5. Configura CORS con los dominios exactos que Base44 muestre para producción
   y preview/editor (sin rutas ni slash final), separados por comas:

   ```text
   https://<dominio-publicado-de-tu-app-base44>,https://<dominio-preview-o-editor-de-base44>
   ```

   Pega ese texto en Render → servicio → **Environment** →
   `ALLOWED_ORIGINS`; guarda y redepliega. Los dominios concretos están
   **PENDIENTES** hasta crear/abrir la app Base44.

6. Prueba de nuevo `/health` desde el navegador publicado de Base44 y revisa
   DevTools → Network para confirmar que el preflight CORS y la solicitud API
   tienen `Access-Control-Allow-Origin` igual al origin Base44.

### Variables para Render

Valores de servicio contrastados con [render.yaml](../render.yaml) y
`backend/src/config.ts`:

| Variable                             | Valor / manejo                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `STELLAR_NETWORK`                    | `testnet` — público                                                                         |
| `NETWORK_PASSPHRASE`                 | `Test SDF Network ; September 2015` — público                                               |
| `SOROBAN_RPC_URL`                    | `https://soroban-testnet.stellar.org` — público                                             |
| `HORIZON_URL`                        | `https://horizon-testnet.stellar.org` — público                                             |
| `CONTRACT_ID`                        | `CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI` — público                        |
| `PORT`                               | `10000` — Render lo usa para el servidor                                                    |
| `DATABASE_URL`                       | `/app/data/app.db` — persistente                                                            |
| `EVIDENCE_STORAGE_DIR`               | `/app/data/evidence` — persistente                                                          |
| `ALLOWED_ORIGINS`                    | **PENDIENTE:** dominios HTTPS exactos de Base44, separados por coma                         |
| `RATE_LIMIT_MAX`                     | `100` solicitudes por ventana — público                                                     |
| `RATE_LIMIT_WINDOW_MS`               | `60000` milisegundos — público                                                              |
| `INDEXER_POLL_INTERVAL_MS`           | `5000` — público                                                                            |
| `INDEXER_START_LEDGER`               | `0` — público; primer arranque usa retención RPC disponible                                 |
| `ADMIN_API_KEY`                      | No requerido por las rutas actuales; si se configura, trátalo como **secreto**.             |
| `DEPLOYER_SECRET` y `SMOKE_*_SECRET` | No se cargan en el backend público; son **secretos**, no los configures ni copies a Base44. |

### CORS y límites

`ALLOWED_ORIGINS` admite una allowlist separada por comas. Los valores deben
ser origins completos (`https://host`), no URLs de páginas. Añade el origin de
producción y el origin de preview/editor que Base44 muestre en sus ajustes. El
backend responde `Access-Control-Allow-Credentials: true`.

`ALLOWED_ORIGINS=*` está soportado como opción temporal de desarrollo: refleja
cualquier origin y, junto con credenciales, amplía mucho la superficie de
ataque. **No lo uses en el despliegue público**; cámbialo por los origins
exactos antes de dar acceso a usuarios.

El límite global actual es **100 peticiones por IP cada 60,000 ms** (una
ventana fija por proceso/plugin). La carga máxima de evidencia es 10 MiB por
archivo. Cachea lecturas donde corresponda, pagina con `limit <= 100` y evita
polling agresivo; el indexer trabaja por separado cada 5 segundos.

## 3. Referencia completa de la API

OpenAPI se generó desde el código actual y contiene 17 paths en
[`docs/openapi.json`](./openapi.json), versión `0.4.0`. La interfaz Swagger
será `/docs` en la URL pública cuando se publique. La especificación es el
contrato exacto de parámetros y esquemas.

En los `curl` de esta sección define `API_BASE_URL` con el hostname HTTPS real
asignado por Render; el valor está pendiente hasta publicar el servicio.

### Endpoints y peticiones

| Método y ruta                    | Parámetros y tipos                                                                                                                                                                                                                                                                                                         | Ejemplo cURL                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | Sin parámetros.                                                                                                                                                                                                                                                                                                            | `curl -i "$API_BASE_URL/health"`                                                                                                                                                                                                                                                                                                                              |
| `GET /campaigns`                 | Query opcionales `status` enum, `page` entero (default 1), `limit` entero 1–100 (default 20), `search` string máx. 200.                                                                                                                                                                                                    | `curl "$API_BASE_URL/campaigns?status=Active&page=1&limit=20&search=agua"`                                                                                                                                                                                                                                                                                    |
| `GET /campaigns/:id`             | Path requerido `id`: entero 1..4294967295.                                                                                                                                                                                                                                                                                 | `curl "$API_BASE_URL/campaigns/2"`                                                                                                                                                                                                                                                                                                                            |
| `GET /campaigns/:id/donations`   | Path `id` requerido; query `page`, `limit` opcionales con mismos límites.                                                                                                                                                                                                                                                  | `curl "$API_BASE_URL/campaigns/2/donations?page=1&limit=20"`                                                                                                                                                                                                                                                                                                  |
| `GET /campaigns/:id/timeline`    | Path `id` requerido; query `page`, `limit` opcionales.                                                                                                                                                                                                                                                                     | `curl "$API_BASE_URL/campaigns/2/timeline?page=1&limit=20"`                                                                                                                                                                                                                                                                                                   |
| `GET /campaigns/:id/audit`       | Path requerido `id`: entero positivo.                                                                                                                                                                                                                                                                                      | `curl "$API_BASE_URL/campaigns/2/audit"`                                                                                                                                                                                                                                                                                                                      |
| `GET /donors/:address/donations` | Path requerido `address`: clave pública Stellar `G...`; query `page`, `limit` opcionales.                                                                                                                                                                                                                                  | `curl "$API_BASE_URL/donors/GCL3AOWMDCDC7S42OYBQ4Q37IX32AG336XPZADQF6VACDSM3D5FC53QE/donations?page=1&limit=20"`                                                                                                                                                                                                                                              |
| `GET /stats`                     | Sin parámetros.                                                                                                                                                                                                                                                                                                            | `curl "$API_BASE_URL/stats"`                                                                                                                                                                                                                                                                                                                                  |
| `POST /tx/create-campaign`       | JSON requerido: `source`, `org`, `token` string; `title` string 1–120; `description_uri` URL; `milestones` array 1–32 de `{description:string 1–500, amount:string positiva}`; `verifiers` array 1–32 de direcciones; `threshold` entero positivo; `deadline` string u64 futuro. `source == org`; verificadores distintos. | `curl -X POST "$API_BASE_URL/tx/create-campaign" -H 'content-type: application/json' -d '{"source":"<ORG_G>","org":"<ORG_G>","token":"<TOKEN_C>","title":"Campaña demo","description_uri":"https://example.org/demo","milestones":[{"description":"Primera etapa","amount":"10000000"}],"verifiers":["<VERIFIER_G>"],"threshold":1,"deadline":"1806963344"}'` |
| `POST /tx/donate`                | JSON requerido: `source`, `donor` direcciones iguales; `campaign_id` entero positivo; `amount` cadena decimal positiva en unidades mínimas.                                                                                                                                                                                | `curl -X POST "$API_BASE_URL/tx/donate" -H 'content-type: application/json' -d '{"source":"<DONOR_G>","donor":"<DONOR_G>","campaign_id":4,"amount":"10000000"}'`                                                                                                                                                                                              |
| `POST /tx/submit-evidence`       | JSON requerido: `campaign_id` entero positivo; `milestone_index` entero 0–31; `evidence_hash` 64 caracteres hex minúscula; `evidence_uri` URL.                                                                                                                                                                             | `curl -X POST "$API_BASE_URL/tx/submit-evidence" -H 'content-type: application/json' -d '{"campaign_id":4,"milestone_index":0,"evidence_hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","evidence_uri":"https://example.org/evidence.pdf"}'`                                                                                         |
| `POST /tx/approve-milestone`     | JSON requerido: `source`, `verifier` direcciones iguales; `campaign_id` entero positivo; `milestone_index` entero 0–31.                                                                                                                                                                                                    | `curl -X POST "$API_BASE_URL/tx/approve-milestone" -H 'content-type: application/json' -d '{"source":"<VERIFIER_G>","verifier":"<VERIFIER_G>","campaign_id":3,"milestone_index":0}'`                                                                                                                                                                          |
| `POST /tx/claim-refund`          | JSON requerido: `source`, `donor` direcciones iguales; `campaign_id` entero positivo.                                                                                                                                                                                                                                      | `curl -X POST "$API_BASE_URL/tx/claim-refund" -H 'content-type: application/json' -d '{"source":"<DONOR_G>","donor":"<DONOR_G>","campaign_id":4}'`                                                                                                                                                                                                            |
| `POST /tx/submit`                | JSON requerido `{xdr:string}` de envelope firmado, 1–100000 chars; backend valida que apunte al contrato y método permitidos.                                                                                                                                                                                              | `curl -X POST "$API_BASE_URL/tx/submit" -H 'content-type: application/json' -d '{"xdr":"<SIGNED_XDR_FROM_WALLET>"}'`                                                                                                                                                                                                                                          |
| `POST /evidence/upload`          | Multipart requerido `file`: PDF, PNG o JPEG; máximo 10 MiB.                                                                                                                                                                                                                                                                | `curl -X POST "$API_BASE_URL/evidence/upload" -F 'file=@evidence.pdf;type=application/pdf'`                                                                                                                                                                                                                                                                   |
| `GET /evidence/:hash`            | Path requerido `hash`: digest SHA-256 de 64 hex minúsculas. Devuelve bytes del archivo.                                                                                                                                                                                                                                    | `curl "$API_BASE_URL/evidence/<SHA256>" --output evidence.pdf`                                                                                                                                                                                                                                                                                                |
| `GET /evidence/:hash/verify`     | Path requerido `hash`: SHA-256 de 64 hex minúsculas.                                                                                                                                                                                                                                                                       | `curl "$API_BASE_URL/evidence/<SHA256>/verify"`                                                                                                                                                                                                                                                                                                               |

`<ORG_G>`, `<DONOR_G>`, `<VERIFIER_G>` y `<TOKEN_C>` son marcadores para
reemplazar por las claves/IDs públicos de las tablas de esta guía; no son
valores literales.

### Respuestas reales observadas

Estas son respuestas reales de la instancia local del backend consultando
SQLite sincronizada con Testnet. Se condensan campos repetitivos cuando se
indica; no constituyen la respuesta de un host público.

```json
GET /health -> 200
{"status":"ok"}

GET /stats -> 200
{"total_donated":"280100000","campaign_count":4,"donor_count":4,"total_released":"150100000"}
```

`GET /campaigns` respondió 4 campañas con paginación. Ejemplo de la campaña 2:

```json
GET /campaigns/2 -> 200
{
  "id": 2,
  "org": "GAVYQQXKLPOMVJUQ34733W4D56OCL4WSEOMTMOBLQW7GB5RIGPCMZLWE",
  "token": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "title": "Agua potable para escuela rural",
  "description_uri": "https://example.org/clearfun-demo/campaigns/agua-escuela-rural",
  "goal": "150000000",
  "deadline": 1806963344,
  "threshold": 2,
  "verifiers": [
    "GDFOF6COLLXLML6HE5DCUWZNTRF2J5JT72KDSEVM7VLB35H6MDUZDQIY",
    "GAUNN623QGHNJNP7K2DXTSFW5W6X4ADDCT4DE47MQ4KR46HDFXGU32FY"
  ],
  "total_raised": "150000000",
  "total_released": "150000000",
  "total_refunded": "0",
  "status": "Completed",
  "progress_percent": 100,
  "funds_held": "0",
  "milestones": [
    {"index":0,"description":"Perforación y análisis del pozo","amount":"60000000","status":"Released","evidence_hash":"cfbf8f9dff427b55e2ec930898d14e1a07450d3171773ce8c17a3a38c410841f","evidence_uri":"https://example.org/clearfun-demo/evidence/agua-escuela-rural-0-cfbf8f9dff427b55e2ec930898d14e1a07450d3171773ce8c17a3a38c410841f.pdf","approvals":["GDFOF6COLLXLML6HE5DCUWZNTRF2J5JT72KDSEVM7VLB35H6MDUZDQIY","GAUNN623QGHNJNP7K2DXTSFW5W6X4ADDCT4DE47MQ4KR46HDFXGU32FY"]},
    {"index":1,"description":"Instalación de bomba y filtros","amount":"90000000","status":"Released","evidence_hash":"53ce8c84d3f65936e7b4a1150999a2e457295ac734089f0a66d2b28608a33483","evidence_uri":"https://example.org/clearfun-demo/evidence/agua-escuela-rural-1-53ce8c84d3f65936e7b4a1150999a2e457295ac734089f0a66d2b28608a33483.pdf","approvals":["GDFOF6COLLXLML6HE5DCUWZNTRF2J5JT72KDSEVM7VLB35H6MDUZDQIY","GAUNN623QGHNJNP7K2DXTSFW5W6X4ADDCT4DE47MQ4KR46HDFXGU32FY"]}
  ]
}
```

Respuestas reales compactas adicionales:

```json
GET /campaigns/2/donations -> 200
{"data":[{"campaign_id":2,"donor":"GBVQRXGWFRNRW7PCGEGNKY6ULUDO7AQMH4HG4I444MYY5ECVM7KY4DKH","amount":"60000000","refunded_amount":"0","updated_ledger":5076835},{"campaign_id":2,"donor":"GCL3AOWMDCDC7S42OYBQ4Q37IX32AG336XPZADQF6VACDSM3D5FC53QE","amount":"50000000","refunded_amount":"0","updated_ledger":5076833},{"campaign_id":2,"donor":"GDOPQWKZJSIIK3TSU6I3FAFSGQUSOS3HMW6O6AAQG656MARN3ODUSJS6","amount":"40000000","refunded_amount":"0","updated_ledger":5076834}],"pagination":{"page":1,"limit":20,"total":3,"pages":1}}

GET /campaigns/2/timeline -> 200 (13 eventos)
{"data":[{"event_id":"0021804827407343616-0000000000","tx_hash":"6fc751de71d1829130ad154ce8cee45a260f11ee6e62e7afb37d3c7e00f91884","ledger":5076832,"timestamp":"2026-10-07T21:15:47Z","type":"campaign_created","payload":{"topics":["campaign_created",2],"value":{"deadline":"1806963344","goal":"150000000","org":"GAVYQQXKLPOMVJUQ34733W4D56OCL4WSEOMTMOBLQW7GB5RIGPCMZLWE","token":"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"}},"explorer_url":"https://stellar.expert/explorer/testnet/tx/6fc751de71d1829130ad154ce8cee45a260f11ee6e62e7afb37d3c7e00f91884"}],"pagination":{"page":1,"limit":20,"total":13,"pages":1}}

GET /donors/GCL3.../donations -> 200
{"data":[{"campaign_id":3,"donor":"GCL3AOWMDCDC7S42OYBQ4Q37IX32AG336XPZADQF6VACDSM3D5FC53QE","amount":"30000000","refunded_amount":"0","updated_ledger":5076837,"title":"Útiles escolares para 200 niños","status":"Active"},{"campaign_id":2,"donor":"GCL3AOWMDCDC7S42OYBQ4Q37IX32AG336XPZADQF6VACDSM3D5FC53QE","amount":"50000000","refunded_amount":"0","updated_ledger":5076833,"title":"Agua potable para escuela rural","status":"Completed"}],"pagination":{"page":1,"limit":20,"total":2,"pages":1}}

GET /campaigns/2/audit -> 200
{"campaign_id":2,"accounting":{"total_incoming":"150000000","total_released":"150000000","total_refunded":"0","total_outgoing":"150000000","expected_contract_balance":"0"},"on_chain":{"total_raised":"150000000","total_released":"150000000","contract_balance":"130000000"},"consistent":false,"verified_at":"2026-10-07T22:26:41.905Z"}
```

**Atención:** auditoría reportó realmente `consistent:false`. El balance
consultado es el balance total del contrato para ese token y agrega fondos
retenidos por otras campañas; el valor no se puede atribuir a campaña 2. No
muestres “auditoría consistente” basándote en esa respuesta.

Pruebas reales de preparación `/tx/*`: `create-campaign`, `donate`,
`submit-evidence`, `approve-milestone` y `claim-refund` devolvieron HTTP 200 con
`signed:false`; el XDR parseó como `invokeHostFunction` con cero firmas. Se
descartó cada XDR sin enviarlo. `/tx/submit` se probó con XDR deliberadamente
inválido y devolvió `400 {"error":{"code":"INVALID_TRANSACTION","message":"Signed transaction XDR is invalid."}}`.

Evidencia real de la prueba temporal: `/evidence/upload` devolvió HTTP 201 con
hash `2db9204c62d574f84e20030f0377dc9d3ac08f8ed8c714b12a53ea4b0cee361e`;
descarga devolvió HTTP 200 (`application/pdf`, 40 bytes), y verify devolvió
`file_matches_hash:true`, `on_chain:false`, `verified:false`. El archivo de
prueba se eliminó al terminar.

### Errores REST y de contrato

La API normaliza errores como `{ "error": { "code": "...", "message": "..." } }`.
Los códigos implementados son:

| HTTP | Código API                | Significado para mostrar                                     |
| ---- | ------------------------- | ------------------------------------------------------------ |
| 400  | `INVALID_REQUEST`         | Revisa los campos, tipos, límites y formato de la solicitud. |
| 400  | `INVALID_TRANSACTION`     | XDR inválido, sin firma o no permitido por este relay.       |
| 400  | `FILE_REQUIRED`           | Selecciona un archivo de evidencia.                          |
| 404  | `CAMPAIGN_NOT_FOUND`      | No se encontró esa campaña en el índice.                     |
| 404  | `EVIDENCE_NOT_FOUND`      | No se encontró el archivo de evidencia.                      |
| 413  | `FILE_TOO_LARGE`          | El archivo supera 10 MiB.                                    |
| 415  | `UNSUPPORTED_FILE_TYPE`   | Solo se admiten PDF, PNG o JPEG con contenido compatible.    |
| 429  | `RATE_LIMITED`            | Demasiadas peticiones; espera antes de volver a intentar.    |
| 500  | `INTERNAL_ERROR`          | Fallo interno o RPC; no se devuelven detalles sensibles.     |
| 503  | `CONTRACT_NOT_CONFIGURED` | El backend no tiene contrato Soroban configurado.            |

Errores numéricos del contrato Soroban (envelope de contrato; puede que la API
muestre `INTERNAL_ERROR` sin decodificar el error Soroban):

| Código | Error contrato             | Traducción sugerida                                          |
| -----: | -------------------------- | ------------------------------------------------------------ |
|      1 | `AlreadyInitialized`       | El contrato ya fue inicializado.                             |
|      2 | `NotInitialized`           | El contrato aún no está inicializado.                        |
|      3 | `CampaignNotFound`         | La campaña no existe.                                        |
|      4 | `InvalidCampaign`          | Los datos de la campaña no son válidos.                      |
|      5 | `InvalidMilestone`         | El hito indicado no existe.                                  |
|      6 | `InvalidAmount`            | El importe o descripción del hito no es válido.              |
|      7 | `InvalidThreshold`         | El umbral debe estar entre uno y el número de verificadores. |
|      8 | `InvalidDeadline`          | La fecha límite no es válida o aún no venció para reembolso. |
|      9 | `DuplicateVerifier`        | La lista contiene un verificador repetido.                   |
|     10 | `OrganizationCannotVerify` | La organización no puede verificarse a sí misma.             |
|     11 | `CampaignNotActive`        | La campaña ya no acepta esta acción.                         |
|     12 | `CampaignExpired`          | La fecha límite de la campaña ya pasó.                       |
|     13 | `InvalidMilestoneOrder`    | Primero deben liberarse los hitos anteriores.                |
|     14 | `InvalidMilestoneStatus`   | El hito no está en el estado requerido para esta acción.     |
|     15 | `NotVerifier`              | Esta wallet no está asignada como verificadora.              |
|     16 | `AlreadyApproved`          | Esta wallet ya aprobó el hito.                               |
|     17 | `AlreadyRefunded`          | Esta wallet ya reclamó su reembolso.                         |
|     18 | `NothingToRefund`          | Esta wallet no tiene aportes reembolsables en la campaña.    |
|     19 | `NoRefundDue`              | El redondeo deja un reembolso de cero unidades mínimas.      |
|     20 | `ArithmeticOverflow`       | La cantidad excede el rango entero seguro del contrato.      |

## 4. Freighter: conectar, validar red y firmar

El repo **no tiene instalado** `@stellar/freighter-api` en `node_modules`, ni
lo declara en `package.json`/`pnpm-lock.yaml`; por tanto no existe una “versión
instalada” que pueda confirmarse. **PENDIENTE de Base44:** agregar el paquete
oficial en la herramienta externa. La última versión consultada en el
registro oficial de npm durante esta verificación fue `6.0.1`; los nombres y
firmas siguientes se comprobaron en la documentación oficial de Freighter
para `isConnected`, `requestAccess`, `getNetwork` y `signTransaction`. Si
Base44 resuelve otra versión, vuelve a verificar su API.

Instala `@stellar/freighter-api@6.0.1` en el proyecto frontend Base44 si permite
dependencias npm. Este ejemplo no usa framework. Configura `API_BASE_URL` con
el hostname HTTPS real de Render cuando exista; no uses `localhost`.

```ts
import {
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

const API_BASE_URL = "https://<hostname-real-de-render>";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export async function connectFreighter(): Promise<string> {
  const installed = await isConnected();
  if (installed.error) throw new Error(installed.error.message);
  if (!installed.isConnected) {
    throw new Error(
      "Instala o habilita la extensión Freighter para continuar.",
    );
  }

  const access = await requestAccess();
  if (access.error) throw new Error(access.error.message);
  if (!access.address)
    throw new Error("Freighter no devolvió una clave pública.");

  const network = await getNetwork();
  if (network.error) throw new Error(network.error.message);
  if (
    network.network !== "TESTNET" ||
    network.networkPassphrase !== TESTNET_PASSPHRASE
  ) {
    throw new Error("Cambia Freighter a Stellar Testnet antes de continuar.");
  }
  return access.address;
}

export async function prepareSignAndSubmit(
  path:
    | "/tx/create-campaign"
    | "/tx/donate"
    | "/tx/submit-evidence"
    | "/tx/approve-milestone"
    | "/tx/claim-refund",
  payload: Record<string, unknown>,
  publicKey: string,
) {
  const preparedResponse = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const prepared = await preparedResponse.json();
  if (!preparedResponse.ok) throw apiError(prepared);
  if (prepared.signed !== false || typeof prepared.xdr !== "string") {
    throw new Error("La API no devolvió el XDR sin firmar esperado.");
  }

  const signed = await signTransaction(prepared.xdr, {
    network: "TESTNET",
    address: publicKey,
  });
  if (signed.error) {
    if (/reject/i.test(signed.error.message)) {
      throw new Error("Cancelaste la firma en Freighter.");
    }
    throw new Error(`Freighter no pudo firmar: ${signed.error.message}`);
  }
  if (!signed.signedTxXdr || signed.signerAddress !== publicKey) {
    throw new Error("La wallet no devolvió la firma de la cuenta conectada.");
  }

  const submittedResponse = await fetch(`${API_BASE_URL}/tx/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ xdr: signed.signedTxXdr }),
  });
  const submitted = await submittedResponse.json();
  if (submittedResponse.status !== 200 && submittedResponse.status !== 202) {
    throw apiError(submitted);
  }
  return {
    ...submitted,
    message:
      submitted.status === "PENDING"
        ? "Enviado; la confirmación aún está pendiente."
        : "Confirmado en Stellar Testnet.",
  };
}

function apiError(body: unknown): Error {
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { code?: string; message?: string } }).error
      : undefined;
  if (!error) return new Error("La API devolvió una respuesta no válida.");
  const message = error.message ?? "La solicitud falló.";
  if (error.code === "INVALID_TRANSACTION") {
    return new Error(
      `La transacción fue rechazada antes del envío: ${message}`,
    );
  }
  if (error.code === "INTERNAL_ERROR") {
    return new Error(
      "Falló la simulación/RPC o la operación del contrato. Revisa red, saldo y estado del hito; la API no expone el error Soroban detallado.",
    );
  }
  return new Error(`${error.code ?? "API_ERROR"}: ${message}`);
}
```

`isConnected()` detecta la extensión, `requestAccess()` solicita permiso y
devuelve la dirección pública, `getNetwork()` confirma `TESTNET`, y
`signTransaction()` entrega `signedTxXdr`. Los errores de rechazo del usuario
se muestran sin reintentar automáticamente. Un fallo de saldo/contrato puede
presentarse como `INTERNAL_ERROR` en la API actual, no se puede clasificar con
certeza en el frontend; explica el fallo y permite revisar la campaña/saldo.

### Fondos de Testnet

- XLM de Testnet: usa la wallet de Testnet o Friendbot para una cuenta pública:
  `https://friendbot.stellar.org/?addr=<CLAVE_PUBLICA_G>`. No pegues una
  secret key en un servicio público.
- USDC demo: **no hay issuer ni SAC desplegados actualmente**. Si se configura
  uno, primero se crea el activo clásico de testnet, se establece la trustline
  de cada cuenta y se emite el activo; luego se despliega su SAC con
  `stellar contract asset deploy`. Es un activo de prueba, no USDC de Circle.

## 5. Datos de demo sembrados

`TOKEN_XLM_ID` es el SAC de XLM nativo. Los montos de la tabla son XLM y las
cantidades exactas on-chain están expresadas en unidades base. Los deadline
de campañas 2–4 son `1806963344` = `2027-04-05T22:15:44Z`.

|  ID | Título                          | Token              |     Meta | Recaudado | Liberado | Estado     | Hitos (monto; estado)                                                         | Transacciones representativas                                                                                                                                                                                                                                                                                                                                                       |
| --: | ------------------------------- | ------------------ | -------: | --------: | -------: | ---------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | ClearFun testnet smoke campaign | XLM (`CDLZ...CYS`) | 0.01 XLM |  0.01 XLM | 0.01 XLM | Completada | Smoke-test milestone: 0.01 XLM, Released                                      | [crear](https://stellar.expert/explorer/testnet/tx/d56818a632c431c8ae3dafd9d0ab300e034d50076c6cecff8b5953d23e58ab0a) · [donar](https://stellar.expert/explorer/testnet/tx/668e38dee1be2b375c286ed5ee9be82d92e133b0f58828aeb06ac9578b4d129f) · [liberar](https://stellar.expert/explorer/testnet/tx/a4e4abb92f25d7e09f47e0d80a98a86d108a71c48e724f54cbbddac5223732cb)                |
|   2 | Agua potable para escuela rural | XLM                |   15 XLM |    15 XLM |   15 XLM | Completada | Perforación 6 XLM Released; bomba y filtros 9 XLM Released                    | [crear](https://stellar.expert/explorer/testnet/tx/6fc751de71d1829130ad154ce8cee45a260f11ee6e62e7afb37d3c7e00f91884) · [evidencia 1](https://stellar.expert/explorer/testnet/tx/42f17b22600ef39925d305a505e858020c2d21bf765286fc34adf09ec1f74536) · [liberación final](https://stellar.expert/explorer/testnet/tx/ba1488779c48791be1e62d43508222d120309d76be83cbcf2324541f03f58ac7) |
|   3 | Útiles escolares para 200 niños | XLM                |   20 XLM |    10 XLM |    0 XLM | Activa     | Compra kits 8 XLM EvidenceSubmitted, 1/2 aprobaciones; entrega 12 XLM Pending | [crear](https://stellar.expert/explorer/testnet/tx/30db67a11cb024641057ed6af9d7ee2c6472f4bdb30991d6a9c5a0ba810acbe2) · [evidencia](https://stellar.expert/explorer/testnet/tx/5f01381ede983d00c29329cd655224a6d676e0eb56326f2db06ab6fe86b5ea24) · [aprobación 1/2](https://stellar.expert/explorer/testnet/tx/a22275ba6843fb8465a971167b3015c81057cb976764d19cac4a005018e9e758)     |
|   4 | Reconstrucción de sede vecinal  | XLM                |   12 XLM |     3 XLM |    0 XLM | Activa     | Reparar techo 4 XLM Pending; terminaciones 8 XLM Pending                      | [crear](https://stellar.expert/explorer/testnet/tx/9a7cc9a38b674230961f190a0333d50445a0a0496d0c09addf3eb9177d7adc1e) · [donar 1](https://stellar.expert/explorer/testnet/tx/d40ee60dea15134a87c9499c8cce3eef39d4f24326cda19b3192f7b5816416e5) · [donar 2](https://stellar.expert/explorer/testnet/tx/4dacfc764d79df864f3e5269cf81301fc7d8ea21b9f7e945f164f87806370df5)              |

IDs exactos de campaña 2–4 y sus estados se volvieron a leer desde Testnet y
la respuesta indexada. En la campaña 2, las aprobaciones y liberaciones
restantes ocurrieron en el mismo transaction hash final listado.

### Direcciones públicas de actores

Derivadas por `pnpm --filter @clearfun/scripts print-demo-actors`; el script
solo emite la clave pública y rol:

| Rol           | Clave pública                                              |
| ------------- | ---------------------------------------------------------- |
| Organización  | `GAVYQQXKLPOMVJUQ34733W4D56OCL4WSEOMTMOBLQW7GB5RIGPCMZLWE` |
| Donante 1     | `GCL3AOWMDCDC7S42OYBQ4Q37IX32AG336XPZADQF6VACDSM3D5FC53QE` |
| Donante 2     | `GDOPQWKZJSIIK3TSU6I3FAFSGQUSOS3HMW6O6AAQG656MARN3ODUSJS6` |
| Donante 3     | `GBVQRXGWFRNRW7PCGEGNKY6ULUDO7AQMH4HG4I444MYY5ECVM7KY4DKH` |
| Verificador 1 | `GDFOF6COLLXLML6HE5DCUWZNTRF2J5JT72KDSEVM7VLB35H6MDUZDQIY` |
| Verificador 2 | `GAUNN623QGHNJNP7K2DXTSFW5W6X4ADDCT4DE47MQ4KR46HDFXGU32FY` |

Para importar manualmente una identidad de demo en Freighter, abre el selector
de cuentas → importar/añadir cuenta → importa la clave secreta de la variable
correspondiente dentro de tu `.env` local: `SMOKE_ORG_SECRET` para organización,
`SMOKE_VERIFIER_1_SECRET` o `SMOKE_VERIFIER_2_SECRET` para verificadores y
`SMOKE_DONOR_SECRET` (o `_2_`/`_3_`) para donantes. El valor secreto se copia
solo localmente desde tu gestor/terminal privada a Freighter; nunca al chat,
Base44, navegador remoto, documentación, URL o formulario web. Son cuentas
desechables financiadas en Testnet; evita usar fondos o cuentas reales.

## 6. Modelo de datos para el frontend

Tipos obtenidos del código de rutas y respuestas reales:

```ts
type CampaignStatus = "Active" | "Completed" | "Expired" | "Cancelled";
type MilestoneStatus = "Pending" | "EvidenceSubmitted" | "Released";

interface Campaign {
  id: number;
  org: string; // Stellar public address G...
  token: string; // contract address C...
  title: string;
  description_uri: string;
  goal: string; // i128 en unidades mínimas
  deadline: number; // Unix epoch en segundos
  threshold: number;
  verifiers: string[];
  total_raised: string; // unidades mínimas
  total_released: string; // unidades mínimas
  total_refunded: string; // unidades mínimas
  status: CampaignStatus;
  progress_percent: number;
  funds_held: string; // unidades mínimas
  milestones?: Milestone[]; // incluido en GET /campaigns/:id
}
interface Milestone {
  index: number; // índice base cero
  description: string;
  amount: string; // unidades mínimas
  status: MilestoneStatus;
  evidence_hash: string; // SHA-256 hex
  evidence_uri: string;
  approvals: string[];
}
interface Donation {
  campaign_id: number;
  donor: string;
  amount: string; // unidades mínimas
  refunded_amount: string; // unidades mínimas
  updated_ledger: number;
  title?: string; // presente en GET /donors/:address/donations
  status?: CampaignStatus; // presente en historial del donante
}
interface TimelineEvent {
  event_id: string;
  tx_hash: string;
  ledger: number;
  timestamp: string; // ISO-8601 UTC, termina en Z
  type: string; // nombre de evento on-chain
  payload: unknown; // {topics, value} decodificado
  explorer_url: string;
}
interface AuditSummary {
  campaign_id: number;
  accounting: {
    total_incoming: string;
    total_released: string;
    total_refunded: string;
    total_outgoing: string;
    expected_contract_balance: string;
  };
  on_chain: {
    total_raised: string;
    total_released: string;
    contract_balance: string;
  };
  consistent: boolean;
  verified_at: string; // ISO-8601 UTC
}
interface Stats {
  total_donated: string; // unidades mínimas
  campaign_count: number;
  donor_count: number;
  total_released: string; // unidades mínimas
}
```

Todos los strings de importe son enteros en unidades mínimas; no aplicar
formato decimal de XLM antes de dividir por `10^7`. `deadline` es Unix seconds
(no milisegundos); `timestamp`/`verified_at` son ISO en UTC. Valores enum y
traducciones sugeridas:

- `Active` → Activa; `Completed` → Completada; `Expired` → Vencida;
  `Cancelled` → Cancelada.
- `Pending` → Pendiente; `EvidenceSubmitted` → Evidencia enviada;
  `Released` → Liberado.

La respuesta de `/campaigns/:id/audit` contiene un balance total del contrato
y puede declarar `consistent:false` en campañas individuales aunque los
totales de la campaña coincidan. La API no modela una entidad separada de
token/decimales, refund marker ni ledger status del indexer.

## 7. Reglas de negocio para la interfaz

- **Donante:** puede donar antes del deadline y mientras la campaña está
  `Active`. La interfaz debe limitar aporte a
  `goal - total_raised`; el contrato actual no impone ese límite y el excedente
  puede quedar bloqueado al completarse el objetivo.
- **Organización:** crea campañas con al menos un hito y umbral válido; no
  puede ser verificadora. Puede presentar evidencia de un hito `Pending` solo
  después de que todos los hitos anteriores estén `Released`.
- **Verificador:** solo si su wallet está en `verifiers`; requiere evidencia
  `EvidenceSubmitted`; una aprobación por wallet/hito. La liberación ocurre
  automáticamente al alcanzar threshold si hay fondos.
- **Cualquiera:** puede llamar `release_milestone` si aprobaciones alcanzaron
  umbral y fondos están disponibles. No existe endpoint REST de preparación
  para esta llamada; requiere SDK/contract call adicional fuera de la API
  actual.
- **Reembolso:** contrato permite reclamar cuando `deadline` pasó y campaña
  no está `Completed` ni `Cancelled`; se requiere aporte y aún no haber
  reclamado. El cálculo es `floor(aporte_donante * (total_raised -
total_released) / total_raised)`. El primer reembolso marca `Expired`.
- **Cancelación:** solo organización y campaña sin fondos; no existe ruta de
  preparación `/tx/cancel-campaign` en la API actual.
- **Fondos/saldo:** valores monetarios se mantienen en BigInt/cadenas. Las
  cifras de la UI no sustituyen la simulación ni validación on-chain.
- **Auditoría:** no presentar `consistent:true` como garantía sin revisar la
  semántica del balance total compartido; la observación real de campaña 2 fue
  `false` y mostró 130,000,000 unidades del resto de campañas.
- **Evidencia:** el hash garantiza igualdad de bytes, no autenticidad del gasto.
  Los URIs del seed son ficticios y no apuntan a facturas reales.
- **Testnet:** transacciones y actores son públicos. Mostrar aviso “Demo
  Testnet — fondos sin valor” y no cargar datos personales reales.

## 8. Verificación final ejecutada

No había `API_BASE_URL` pública ni Docker instalado. Por eso se verificó
contra el backend Node local conectado a Testnet, en vez de fingir una URL
pública o decir que era Docker. Los datos siguientes son respuestas reales;
Base44 seguirá bloqueado hasta desplegar Render y asignar el hostname.

Pruebas ejecutadas:

```text
GET /health                 HTTP 200 {"status":"ok"}
GET /stats                  HTTP 200 {"total_donated":"280100000","campaign_count":4,"donor_count":4,"total_released":"150100000"}
GET /campaigns?page=1&limit=20 HTTP 200; 4 campañas, incluye IDs 1,2,3,4
GET /campaigns/2            HTTP 200; Completed, meta/recaudado/liberado 150000000
GET /campaigns/2/timeline   HTTP 200; 13 eventos, enlaces explorer
GET /campaigns/2/audit      HTTP 200; consistent=false, ver advertencia anterior
POST /tx/donate             HTTP 200; XDR parseado, invokeHostFunction, 0 firmas, no enviado
Origin https://base44-preview.example -> Access-Control-Allow-Origin: https://base44-preview.example (prueba con wildcard temporal)
```

Verificación de cadenas secretas en ambos archivos generados:

```text
Regex S[A-Z2-7]{55}: 0 resultados en BASE44_CONNECTION_PACK.md y base44-config.json
```

Comandos reproducibles una vez que `API_BASE_URL` esté asignada:

```sh
curl -i "$API_BASE_URL/health"
curl -i "$API_BASE_URL/stats"
curl -i "$API_BASE_URL/campaigns?page=1&limit=20"
curl -i "$API_BASE_URL/campaigns/2"
curl -i "$API_BASE_URL/campaigns/2/timeline"
curl -i "$API_BASE_URL/campaigns/2/audit"
```

La prueba temporal de transacción solo preparó y parseó XDR; no lo firmó ni
envió. La configuración de CORS de producción debe ser la allowlist real de
Base44, no el wildcard usado en esa prueba local.

## PENDIENTE

1. Crear/conectar el servicio Render desde `render.yaml`, configurar
   `CONTRACT_ID` y obtener el dominio HTTPS real; entonces verificarlo con
   `curl`.
2. Crear la app Base44 y copiar sus origins exactos de producción y preview a
   `ALLOWED_ORIGINS`; redeplegar y volver a probar CORS. No usar `*` en
   producción.
3. Base44 aún no tiene `@stellar/freighter-api`; la versión `6.0.1` fue
   consultada en npm/docs oficiales pero no está instalada localmente.
4. No existe `TOKEN_USDC_ID` ni issuer de prueba; el demo actual usa XLM SAC.
5. La auditoría por campaña informa balance global del contrato; no tratarla
   como balance aislado hasta corregir esa limitación del backend en una fase
   autorizada.
