# Fase 4: API REST, transacciones y evidencias

## Qué se implementó

- API Fastify con validación Zod y errores JSON uniformes (`error.code` y
  `error.message`):
  - `GET /health`
  - `GET /campaigns`, `GET /campaigns/:id`,
    `GET /campaigns/:id/donations`, `GET /campaigns/:id/timeline` y
    `GET /campaigns/:id/audit`
  - `GET /donors/:address/donations` y `GET /stats`
  - `POST /tx/create-campaign`, `/tx/donate`, `/tx/submit-evidence`,
    `/tx/approve-milestone`, `/tx/claim-refund` y `/tx/submit`
  - `POST /evidence/upload`, `GET /evidence/:hash` y
    `GET /evidence/:hash/verify`
- Los cinco endpoints de preparación simulan y ensamblan XDR Soroban sin
  firmar. `/tx/submit` acepta solamente XDR con firmas, una invocación al
  contrato configurado y un método permitido; espera confirmación y devuelve
  el hash y el enlace de Stellar Expert. Las claves de usuarios nunca llegan
  al backend.
- Auditoría compara ingresos, liberaciones y reembolsos indexados con la
  campaña y el balance actual del contrato en Testnet.
- Almacenamiento de evidencia local mediante `StorageProvider`; acepta PDF,
  PNG y JPEG, verifica tipo y bytes mágicos, limita el tamaño a 10 MiB y
  calcula SHA-256. La interfaz permite sustituir el almacenamiento por S3 o
  IPFS.
- CORS configurable con `ALLOWED_ORIGINS`, Helmet, rate limiting global y
  multipart limitado a un archivo. Swagger UI está disponible en `/docs` y
  el OpenAPI exportado se sirve y guarda en `docs/openapi.json`.
- Configuración agregada a `.env.example`: `ALLOWED_ORIGINS`,
  `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` y `EVIDENCE_STORAGE_DIR`.

## Inicio local

Desde la raíz del monorepo, configura `.env` con los valores locales y el
`CONTRACT_ID` desplegado, instala dependencias y ejecuta:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @clearfun/backend dev
```

La API escucha en `http://localhost:3000` por defecto. Asegúrate de que el
indexer haya sincronizado la campaña antes de consultar sus vistas indexadas.
Los importes `amount`, `goal`, ingresos y saldos son cadenas enteras en
unidades base del token (stroops para XLM), para preservar precisión.

## Ejemplos cURL

Los siguientes ejemplos asumen que la API está en `http://localhost:3000`.
Sustituye direcciones, `TOKEN_XLM_ID`, `CAMPAIGN_ID`, hashes y XDR por valores
de tus actores y respuestas reales de Testnet. En PowerShell, `curl.exe`
permite usar las mismas opciones.

### Salud, campañas, donaciones, timeline y auditoría

```sh
curl http://localhost:3000/health
curl 'http://localhost:3000/campaigns?status=Active&page=1&limit=20&search=agua'
curl http://localhost:3000/campaigns/1
curl 'http://localhost:3000/campaigns/1/donations?page=1&limit=20'
curl 'http://localhost:3000/campaigns/1/timeline?page=1&limit=20'
curl http://localhost:3000/campaigns/1/audit
```

`/campaigns/:id` incluye hitos, verificadores, porcentaje de progreso y fondos
retenidos. La respuesta de `/campaigns/:id/audit` expone `consistent` junto
con los totales indexados y consultados on-chain.

### Donaciones por wallet y estadísticas

```sh
curl 'http://localhost:3000/donors/GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY/donations?page=1&limit=20'
curl http://localhost:3000/stats
```

### Preparar XDR sin firmar

Cada ruta devuelve `{ "xdr": "...", "signed": false }`. La wallet debe firmar el
XDR con la dirección fuente correspondiente; no se deben enviar claves
secretas a la API.

```sh
curl -X POST http://localhost:3000/tx/create-campaign \
  -H 'content-type: application/json' \
  -d '{
    "source":"GBZMF2I4QQCDVZY3R55F7667WQOBUALKBX6IPUMLAPNJCIU6KVLOPMHN",
    "org":"GBZMF2I4QQCDVZY3R55F7667WQOBUALKBX6IPUMLAPNJCIU6KVLOPMHN",
    "token":"'"$TOKEN_XLM_ID"'",
    "title":"Agua potable",
    "description_uri":"https://example.org/agua",
    "milestones":[{"description":"Pozo terminado","amount":"100000"}],
    "verifiers":["GC3XAM7HEDTQVIPPZE3C7KBCBZYKR3XSTKWUUFDTZW55YNKDNOCWDCAH"],
    "threshold":1,
    "deadline":"2000000000"
  }'

curl -X POST http://localhost:3000/tx/donate \
  -H 'content-type: application/json' \
  -d '{
    "source":"GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY",
    "donor":"GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY",
    "campaign_id":1,
    "amount":"100000"
  }'

curl -X POST http://localhost:3000/tx/submit-evidence \
  -H 'content-type: application/json' \
  -d '{
    "campaign_id":1,
    "milestone_index":0,
    "evidence_hash":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "evidence_uri":"https://example.org/evidence/pozo.pdf"
  }'

curl -X POST http://localhost:3000/tx/approve-milestone \
  -H 'content-type: application/json' \
  -d '{
    "source":"GC3XAM7HEDTQVIPPZE3C7KBCBZYKR3XSTKWUUFDTZW55YNKDNOCWDCAH",
    "verifier":"GC3XAM7HEDTQVIPPZE3C7KBCBZYKR3XSTKWUUFDTZW55YNKDNOCWDCAH",
    "campaign_id":1,
    "milestone_index":0
  }'

curl -X POST http://localhost:3000/tx/claim-refund \
  -H 'content-type: application/json' \
  -d '{
    "source":"GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY",
    "donor":"GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY",
    "campaign_id":1
  }'
```

Tras firmar el XDR retornado con Freighter u otra wallet compatible, envía el
envelope firmado:

```sh
curl -X POST http://localhost:3000/tx/submit \
  -H 'content-type: application/json' \
  -d '{"xdr":"'"$SIGNED_XDR"'"}'
```

El resultado incluye el hash, el estado de confirmación y `explorer_url`.
Mientras el RPC no confirme dentro del periodo de espera, la respuesta es HTTP
202 con estado `PENDING`.

### Cargar, descargar y verificar evidencia

`/evidence/upload` responde con `hash`, `uri` y `content_type`; usa ese hash y
URI en la transacción `submit-evidence`.

```sh
curl -X POST http://localhost:3000/evidence/upload \
  -F 'file=@./evidence.pdf;type=application/pdf'
curl http://localhost:3000/evidence/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --output evidence-download.pdf
curl http://localhost:3000/evidence/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/verify
```

La verificación informa si el contenido conserva el hash calculado y si ese
hash aparece en un hito indexado desde el contrato.

## Verificación ejecutada

Comandos ejecutados desde la raíz:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm --filter @clearfun/backend openapi:export
```

Resultados: instalación congelada y build correctos; Vitest pasó con 13
pruebas; ESLint y Prettier pasaron. OpenAPI se regeneró en
[`openapi.json`](./openapi.json).

## Decisiones y límites

- CORS queda cerrado a orígenes de navegador si `ALLOWED_ORIGINS` está vacío;
  configura explícitamente los orígenes permitidos.
- Las lecturas de campañas y el timeline dependen de SQLite/indexer. La ruta de
  auditoría consulta además el estado actual del contrato y del token.
- Los archivos se guardan en disco bajo `EVIDENCE_STORAGE_DIR`; el URI es una
  ruta relativa `/evidence/<sha256>`, servida por esta API.
- Las operaciones Soroban mutables se restringen a los cinco métodos
  solicitados. El endpoint de envío no puede utilizarse como relay genérico de
  otras operaciones.
