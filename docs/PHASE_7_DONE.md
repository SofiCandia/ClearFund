# Fase 7: paquete de conexión para Base44

## Entregables

- [`BASE44_CONNECTION_PACK.md`](./BASE44_CONNECTION_PACK.md): paquete legible
  para copiar en un chat de Base44; especifica red, contrato, API, respuestas
  reales, CORS, Freighter, actores, modelos y reglas de negocio.
- [`base44-config.json`](./base44-config.json): versión estructurada para
  transferencia automática.
- Añadido `scripts/print-demo-actors.ts` y el comando
  `pnpm --filter @clearfun/scripts print-demo-actors`; deriva desde el `.env`
  local y solo imprime claves públicas con roles.
- CORS ahora reconoce `ALLOWED_ORIGINS=*` como allow-all de desarrollo, reflejando
  el Origin recibido. Añadida prueba de allowlist exacta y wildcard. No debe
  usarse en el despliegue público.

## Verificaciones reales

- Identidad del contrato/deploy comprobada contra Horizon Testnet:
  ledger `5076097`, deploy exitoso, creado en `2026-10-07T20:14:32Z`.
- Token XLM consultado por Soroban RPC: `name=native`, `symbol=native`,
  `decimals=7`. No hay token/issuer/SAC USDC configurado.
- Ejecutado `print-demo-actors`: imprimió únicamente las seis direcciones G
  públicas necesarias; ningún secreto fue mostrado.
- El backend local sincronizó campañas `1–4`; campañas 2, 3 y 4 coinciden con
  el seed y sus transacciones en Testnet.
- `POST /tx/donate` devolvió HTTP 200; el XDR se parseó como
  `invokeHostFunction`, con cero firmas. No se firmó ni se envió.
- Upload, descarga y verificación de un PDF temporal devolvieron HTTP 201/200;
  archivo eliminado tras la prueba.
- CORS wildcard temporal reflejó el origin de prueba:
  `https://base44-preview.example`. No es un dominio Base44 confirmado.
- Regex `S[A-Z2-7]{55}` en los dos archivos entregables: cero coincidencias.

La API pública **no está desplegada**. No hay hostname Render/Railway en el
repositorio; `render.yaml` es solo un Blueprint. Las llamadas HTTP de esta fase
se hicieron contra Node local y RPC Testnet porque Docker no está instalado.
No se presenta esa URL local como accesible desde Base44.

## Validación ejecutada

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm --filter @clearfun/scripts print-demo-actors
```

El build, lint, formato y suite del backend pasaron; el suite integra ahora
una prueba CORS. La última ejecución registró 14 pruebas Vitest pasando. Las
direcciones públicas y respuestas inspeccionadas se incluyen en el paquete.

## Pendientes para conectar Base44

1. Desplegar el Blueprint Render y copiar el hostname HTTPS real a
   `API_BASE_URL`; validar `/health`, `/stats`, campañas, timeline y auditoría
   con `curl` público.
2. Crear la app Base44; copiar sus origins HTTPS reales de producción y
   preview/editor a `ALLOWED_ORIGINS` (separados por coma), redeplegar y
   repetir prueba CORS.
3. `@stellar/freighter-api` no está instalada en este monorepo ni forma parte
   de Base44. La última versión oficial npm consultada fue `6.0.1`, pero Base44
   debe confirmar/instalar su versión resuelta.
4. No mostrar un flujo USDC: issuer, token y SAC de prueba no existen.
5. No presentar auditoría de campaña como consistente mientras la ruta compare
   el balance global del token con el esperado de una campaña individual.
6. El riesgo de sobre-recaudación indicado en
   [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) sigue bloqueando fondos
   de valor; la UI debe limitar aportes al faltante de meta.
