# Despliegue del backend ClearFun

La API Fastify y el indexer Soroban se ejecutan en el mismo proceso Node.js:
el backend inicia el indexer automáticamente cuando `CONTRACT_ID` está
configurado. SQLite y las evidencias deben residir en almacenamiento persistente.
El servidor emite logs JSON estructurados y expone `GET /health`.

## Ejecutar con Docker Compose

Requisitos: Docker Desktop (Windows/macOS) o Docker Engine con el plugin Compose
(Linux), y el daemon iniciado.

1. En la raíz del monorepo, crea `.env` a partir de la plantilla y configura al
   menos el contrato:

   ```powershell
   Copy-Item .env.example .env
   ```

   Edita `CONTRACT_ID` en `.env`. No añadas secretos de usuarios; el backend no
   firma transacciones. `.env` está excluido de la imagen.

2. Construye y arranca el servicio:

   ```powershell
   docker compose up --build -d
   ```

3. Comprueba salud y logs:

   ```powershell
   Invoke-RestMethod http://localhost:3000/health
   docker compose ps
   docker compose logs --tail=100 backend
   ```

   La respuesta esperada de salud es `{"status":"ok"}`. El servicio Compose
   reinicia con `unless-stopped` y tiene healthcheck HTTP. Los volúmenes
   `clearfun-data` y `clearfun-evidence` persisten SQLite y archivos subidos,
   respectivamente.

4. Para detener la aplicación sin borrar los datos:

   ```powershell
   docker compose down
   ```

   No uses `docker compose down -v` salvo que quieras eliminar explícitamente
   los volúmenes persistentes.

`docker-compose.yml` aplica valores Testnet por defecto, pero lee las
configuraciones opcionales de `.env`. Si se deja `CONTRACT_ID` vacío, la API
responde igualmente y deja el indexer desactivado; no lo dejes vacío en un
despliegue funcional.

## Publicar en Render y obtener HTTPS

El blueprint [render.yaml](../render.yaml) configura el Dockerfile con contexto
de build en la raíz del monorepo, un disco persistente montado en `/app/data`,
healthcheck `/health`, el contrato ClearFun ya desplegado y las variables de
Testnet.

1. Sube el monorepo a un repositorio Git accesible por Render. No subas `.env`
   ni semillas secretas.
2. En Render, selecciona **New + → Blueprint** y conecta ese repositorio.
   Confirma el blueprint `clearfun-backend`; Render construye
   `backend/Dockerfile` con el contexto raíz.
3. El Blueprint ya configura `CONTRACT_ID` con el contrato ClearFun de
   Testnet. Revisa que estas rutas persistentes sean las configuradas:
   - `DATABASE_URL=/app/data/app.db`
   - `EVIDENCE_STORAGE_DIR=/app/data/evidence`
4. Configura `ALLOWED_ORIGINS` como una lista separada por comas de los
   orígenes HTTPS exactos de los clientes autorizados. Vacío significa que no
   se permiten solicitudes CORS desde navegadores.
5. Mantén las variables públicas del Blueprint para Testnet y configura
   `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `INDEXER_POLL_INTERVAL_MS` e
   `INDEXER_START_LEDGER` según la carga y el ledger desde el que quieras
   indexar. No configures `DEPLOYER_SECRET`: el runtime del backend no necesita
   la clave de despliegue.
6. Espera a que el deploy y el healthcheck terminen. Render provisiona HTTPS
   para el dominio `*.onrender.com` del servicio; la URL pública aparece en su
   dashboard. Verifica la URL que muestra Render:

   ```sh
   curl https://<servicio>.onrender.com/health
   ```

   Debe devolver HTTP 200 y `{"status":"ok"}`. La especificación Swagger está en
   `https://<servicio>.onrender.com/docs`; OpenAPI JSON en
   `https://<servicio>.onrender.com/docs/openapi.json`.

El disco de Render persiste tanto la base de datos como las evidencias a través
de deploys. El plan y el disco persistente pueden generar cargos conforme a
los precios actuales de Render.

En la imagen, el entrypoint prepara los permisos de los discos montados y
entrega inmediatamente el proceso del servidor al usuario no privilegiado
`node`.

## Variables de entorno

Configura los siguientes valores en Render (o en `.env` para Compose):

| Variable                   | Uso                                                | Valor recomendado                          |
| -------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `STELLAR_NETWORK`          | Red para enlaces del explorador                    | `testnet`                                  |
| `SOROBAN_RPC_URL`          | RPC del indexer y transacciones                    | `https://soroban-testnet.stellar.org`      |
| `HORIZON_URL`              | Horizon Testnet                                    | `https://horizon-testnet.stellar.org`      |
| `NETWORK_PASSPHRASE`       | Passphrase de Stellar Testnet                      | `Test SDF Network ; September 2015`        |
| `CONTRACT_ID`              | Dirección del contrato ClearFun; activa el indexer | ID del contrato desplegado                 |
| `PORT`                     | Puerto HTTP                                        | Render: `10000`; Compose: `3000`           |
| `DATABASE_URL`             | Archivo SQLite                                     | `/app/data/app.db` en despliegues Docker   |
| `EVIDENCE_STORAGE_DIR`     | Directorio de evidencia                            | `/app/data/evidence` en despliegues Docker |
| `ALLOWED_ORIGINS`          | Orígenes CORS, separados por coma                  | Orígenes HTTPS del cliente                 |
| `RATE_LIMIT_MAX`           | Límite de solicitudes por ventana                  | `100`                                      |
| `RATE_LIMIT_WINDOW_MS`     | Ventana de rate limit en milisegundos              | `60000`                                    |
| `INDEXER_POLL_INTERVAL_MS` | Frecuencia de consulta del indexer                 | `5000`                                     |
| `INDEXER_START_LEDGER`     | Ledger inicial si aún no existe checkpoint         | `0`                                        |

`ADMIN_API_KEY` no es necesario para los endpoints implementados. No configures
`DEPLOYER_SECRET` en el servicio público: los usuarios firman con sus wallets y
el backend solo recibe transacciones ya firmadas.

Los endpoints configurados son los servicios específicos de Stellar Testnet:
`https://soroban-testnet.stellar.org` para Soroban RPC y
`https://horizon-testnet.stellar.org` para Horizon. No los sustituyas por
`https://stellar.org`, que no es el endpoint RPC ni Horizon de Testnet.
