# Fase 5: Contenerización y despliegue del backend

## Qué se hizo

- Añadido `backend/Dockerfile` multi-stage para compilar SDK/backend e instalar
  solo dependencias de producción en una imagen runtime Node.js 22 Debian slim.
  El servidor se ejecuta como usuario no root `node`; un entrypoint mínimo
  cambia la propiedad de los directorios montados para que los discos Docker y
  Render sean escribibles por ese usuario.
- Habilitado el build de `better-sqlite3` con pnpm para que su módulo nativo se
  pueda construir en Linux al crear la imagen.
- Añadido `docker-compose.yml`: backend e indexer corren juntos como lo hace el
  servidor actual, reinicio `unless-stopped`, healthcheck `/health`, logs con
  rotación y volúmenes independientes para SQLite y evidencias.
- Añadidos `render.yaml` y `.dockerignore`. Render usa el contexto raíz del
  monorepo, disco persistente en `/app/data` y healthcheck de la API.
- Documentados los pasos de Compose, despliegue en Render, variables y
  obtención/verificación de URL HTTPS en [`DEPLOY_BACKEND.md`](./DEPLOY_BACKEND.md).

## Verificación

Comandos ejecutados:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
docker --version
docker compose version
```

La instalación congelada y compilación pasaron; Vitest pasó con 13 pruebas;
ESLint y Prettier pasaron. En este entorno Windows, Docker CLI no está
instalado (`docker` no se reconoce), por lo que no fue posible ejecutar
`docker compose up` ni confirmar el healthcheck dentro del contenedor local.
Para completar esa verificación, instala e inicia Docker Desktop y ejecuta los
comandos de Compose indicados en [`DEPLOY_BACKEND.md`](./DEPLOY_BACKEND.md);
Render ejecutará la misma imagen al crear el Blueprint.

## Decisiones

- Se mantiene un solo proceso de servicio para API e indexer porque `server.ts`
  ya gestiona ambos y comparte la conexión SQLite; no se duplican conexiones ni
  checkpoints.
- Los datos de runtime se guardan bajo `/app/data`; el archivo `.env` y los
  secretos quedan fuera del contexto de la imagen.
- El despliegue está preconfigurado para Stellar Testnet. Se debe establecer
  `CONTRACT_ID` en el proveedor antes de desplegar para que el indexer se inicie.
