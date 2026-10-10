# ClearFund × Base44 — paquete de conexión actualizado

## Estado del entorno

El contrato anterior sigue disponible como legacy y no se debe consultar como
la implementación nueva. El despliegue nuevo aún no se pudo completar porque
no hay `DEPLOYER_SECRET` configurado. Por eso el `CONTRACT_ID` activo y los
enlaces/hash de despliegue/smoke nuevos están **pendientes**; no uses un ID
inventado ni `localhost` desde Base44. El detalle de cambios de UI está en
[`BASE44_CHANGES.md`](./BASE44_CHANGES.md).

| Configuración | Estado |
| --- | --- |
| Red | Stellar Testnet |
| Passphrase | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Contrato previo | `LEGACY_CONTRACT_ID`, solo histórico |
| Contrato nuevo | Pendiente del despliegue de esta versión |
| Token XLM | SAC nativo testnet; 7 decimales |
| API pública | Pendiente de publicar el backend |
| CORS Base44 | Pendiente de conocer los origins de producción/preview |

Antes de integrar, despliega el contrato nuevo, copia su ID a `CONTRACT_ID`,
apunta el backend a una SQLite vacía, publica la API en un hostname HTTPS y
configura CORS con los origins exactos. No mezcles las campañas 1–4 del
contrato legacy en las tablas nuevas.

## Endpoints

Base URL: `API_BASE_URL` (pendiente). Los ejemplos siguientes describen las
rutas y formas producidas por Fastify; las respuestas JSON deterministas se
cubren con Vitest local. Aún no son respuestas de una API pública desplegada ni
de campañas on-chain del contrato nuevo.

| Método | Path | Respuesta / propósito |
| --- | --- | --- |
| GET | `/health` | `200 {"status":"ok"}` |
| GET | `/campaigns` | Página `{data:[Campaign],pagination}` |
| GET | `/campaigns/{id}` | Campaign más milestones |
| GET | `/campaigns/{id}/donations` | Posiciones, valores y `withdrawable` |
| GET | `/campaigns/{id}/timeline` | Eventos con hash y explorer URL |
| GET | `/campaigns/{id}/audit` | Totales indexados comparados con getters de esa campaña |
| GET | `/audit/solvency` | Balance vs. suma de held y bonds por token |
| GET | `/donors/{address}/donations` | Historial de posiciones y campaña |
| GET | `/stats` | Totales de campañas, donantes y montos |
| POST | `/tx/create-campaign` | XDR sin firmar; `window_seconds` opcional, defecto 259200 |
| POST | `/tx/donate` | XDR sin firmar |
| POST | `/tx/submit-evidence` | XDR sin firmar |
| POST | `/tx/withdraw` | XDR sin firmar para retirar la posición completa |
| POST | `/tx/claim-refund` | Alias deprecado de `/tx/withdraw` |
| POST | `/tx/release-milestone` | XDR sin firmar; liberación pública |
| POST | `/tx/reclaim-bond` | XDR sin firmar |
| POST | `/tx/approve-milestone` | `410 ENDPOINT_REMOVED` |
| POST | `/tx/submit` | Envía XDR firmado; `200 SUCCESS` o `202 PENDING` |
| POST | `/evidence/upload` | `201 {hash,uri,content_type}` |
| GET | `/evidence/{hash}` | Archivo binario |
| GET | `/evidence/{hash}/verify` | Hash recalculado y coincidencia indexada |

Las cantidades son cadenas enteras en unidades base para no perder precisión.
Cada `/tx/*` que prepara una operación devuelve
`{"xdr":"<XDR base64 sin firmar>","signed":false}`. El texto entre ángulos es
solo una descripción de esquema, no un XDR válido. La wallet firma localmente;
el backend no debe recibir secretos.

## Modelo de campaña de ejemplo

Esta estructura corresponde al contrato/API nuevos; sus valores son un
ejemplo de forma validada en las pruebas HTTP locales:

```json
{
  "id": 1,
  "org": "G...",
  "token": "C...",
  "title": "ClearFund campaign",
  "description_uri": "https://example.org/campaign",
  "goal": "1000",
  "deadline": 1800000000,
  "window_secs": 60,
  "bond_amount": "10",
  "bond_state": "Held",
  "total_raised": "500",
  "total_released": "100",
  "total_withdrawn": "10",
  "held": "390",
  "funded": "490",
  "progress_percent": 49,
  "max_donation": "510",
  "status": "Active",
  "milestones": [
    {
      "index": 0,
      "description": "First milestone",
      "amount": "500",
      "status": "EvidenceSubmitted",
      "evidence_hash": "<sha256>",
      "evidence_uri": "https://example.org/evidence",
      "window_end": 1800000060,
      "released_amount": "0"
    }
  ]
}
```

La forma de posición es
`{campaign_id,donor,amount,shares,current_value,withdrawn,withdrawable,updated_ledger}`.
El cálculo visual de `withdrawable` debe respetar los hitos con ventana
vencida pendiente de liberar y no reemplaza al contrato.

## Reglas UX

- **Donar:** activa, deadline futuro, no es la organización y el monto no
  supera `max_donation`.
- **Retirar mi parte:** `current_value > 0` y `withdrawable=true`.
- **Subir evidencia:** organización conectada; siguiente hito pendiente,
  anteriores liberados y monto íntegro retenido; una ventana completa debe
  caber antes del deadline.
- **Liberar etapa:** evidencia presentada, fin de ventana alcanzado y fondos
  retenidos. Es público y no requiere verificadores.
- **Recuperar garantía:** solo organización, deadline vencido, no completada,
  cero participaciones y bond Held.

Los errores siguen `{error:{code,message}}`. El catálogo español estable está
en [`CONTRACT_API.md`](./CONTRACT_API.md). En particular, la API responde 410 a
aprobaciones de verificadores.

## Ventana de confianza

El silencio equivale a aceptar la evidencia. Una evidencia falsa convincente
puede engañar. La garantía es limitada (hasta 50% del objetivo); no cubre
necesariamente una estafa grande. No hay admin, verificadores ni disputas.
Testnet no es para fondos de valor.

## Pasos de activación

1. Configurar una cuenta deployer financiada y completar
   [`DEPLOY.md`](./DEPLOY.md); verificar transacción, nuevo ID y BPS=1000.
2. Ejecutar smoke-test y seed con cuentas demo, guardar sus hashes públicos y
   revisar getters y balance.
3. Publicar backend; completar `API_BASE_URL`; probar `/health` y
   `/docs/openapi.json` desde el hostname real.
4. Configurar origins HTTPS exactos de Base44 en `ALLOWED_ORIGINS`.
5. Reemplazar en Base44 los ejemplos de respuesta local por respuestas
   obtenidas del hostname y contrato reales; conservar amounts como strings.
