# Fase 2: Despliegue en Stellar Testnet

## Qué se hizo

- Añadidos `scripts/deploy.sh` y `scripts/deploy.ps1` para construir, desplegar
  el WASM optimizado, inicializar el contrato y guardar `CONTRACT_ID` en `.env`.
- Añadidos `scripts/setup-tokens.sh` y su equivalente Windows
  `scripts/setup-tokens.ps1`. Detectan/reutilizan el SAC de XLM nativo y
  permiten calcular/desplegar un SAC `USDC:<issuer>` de testnet.
- Generadas las bindings desde el WASM final con
  `stellar contract bindings typescript` y empaquetadas como `@clearfun/sdk`.
- Añadido `scripts/smoke-test.ts`, un flujo tipado con bindings y SDK que firma
  autorizaciones de admin, organización, donante y verificadores; verifica el
  saldo del SAC de la organización al final.
- Documentados los comandos paso a paso, las claves que necesita el smoke test
  y el procedimiento de emisión de USDC de prueba en [`DEPLOY.md`](./DEPLOY.md).

## Red y despliegue comprobado

- Red: Stellar Testnet (`Test SDF Network ; September 2015`).
- Soroban RPC: `https://soroban-testnet.stellar.org`.
- Contrato inicializado:
  `CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI`
- WASM hash:
  `789afcea7268e68ef64f94ad26d4f6dc7a0826f15f2fb6789b2a04446878710b`
- SAC de XLM:
  `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- `TOKEN_USDC_ID` queda vacío hasta que se configure un issuer de prueba.

Contrato en Stellar Expert:
<https://stellar.expert/explorer/testnet/contract/CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI>

| Operación          | Hash de transacción                                                | Enlace                                                                                                        |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Instalar WASM      | `0ffc088489572905ef6daac48ea7b27f998f2b043336251df1cc76a71b5d3ce6` | <https://stellar.expert/explorer/testnet/tx/0ffc088489572905ef6daac48ea7b27f998f2b043336251df1cc76a71b5d3ce6> |
| Desplegar contrato | `12d997f0981a847dc45cedc563df7119303b0dc394399692572f401d0eeb2ad8` | <https://stellar.expert/explorer/testnet/tx/12d997f0981a847dc45cedc563df7119303b0dc394399692572f401d0eeb2ad8> |
| Inicializar admin  | `e841dee819e616418f8193538018dbd4fd17108e1c6e11e2512fc4c1fe3f4638` | <https://stellar.expert/explorer/testnet/tx/e841dee819e616418f8193538018dbd4fd17108e1c6e11e2512fc4c1fe3f4638> |

Un despliegue de prueba anterior dejó el contrato no inicializado
`CAJBYVQ3TPT2QAVVDHQX2CGSE2HLUODCP7ERX5RNJMUTWWFLA7QQDZE6`; no se usa en
`.env` ni en el smoke test. La versión corregida de `deploy.ps1` parsea el ID
de la salida de Stellar CLI y completó el despliegue e inicialización listados
arriba.

## Smoke test real

El smoke test creó la campaña `1`, donó 100,000 stroops de XLM, subió evidencia
SHA-256, registró ambas aprobaciones y verificó que la organización recibió
exactamente 100,000 stroops. Las transacciones publicadas:

| Operación                 | Hash                                                               | Enlace                                                                                                        |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Crear campaña             | `d56818a632c431c8ae3dafd9d0ab300e034d50076c6cecff8b5953d23e58ab0a` | <https://stellar.expert/explorer/testnet/tx/d56818a632c431c8ae3dafd9d0ab300e034d50076c6cecff8b5953d23e58ab0a> |
| Donar                     | `668e38dee1be2b375c286ed5ee9be82d92e133b0f58828aeb06ac9578b4d129f` | <https://stellar.expert/explorer/testnet/tx/668e38dee1be2b375c286ed5ee9be82d92e133b0f58828aeb06ac9578b4d129f> |
| Enviar evidencia          | `d4bbd36e1eb54cf661bf7d7a615112325d05b205b2303f9959276e6b0f55395c` | <https://stellar.expert/explorer/testnet/tx/d4bbd36e1eb54cf661bf7d7a615112325d05b205b2303f9959276e6b0f55395c> |
| Aprobar (verificador 1/2) | `1cf67a90f627575b4fdfc85680d2908368d8ea11d9ffd8f9551a5f7b0907cdef` | <https://stellar.expert/explorer/testnet/tx/1cf67a90f627575b4fdfc85680d2908368d8ea11d9ffd8f9551a5f7b0907cdef> |
| Aprobar 2/2 y liberar     | `a4e4abb92f25d7e09f47e0d80a98a86d108a71c48e724f54cbbddac5223732cb` | <https://stellar.expert/explorer/testnet/tx/a4e4abb92f25d7e09f47e0d80a98a86d108a71c48e724f54cbbddac5223732cb> |

La evidencia de ejecución proviene del `SentTransaction` final del SDK (hash
presente después de la inclusión) y del balance posterior consultado al SAC.
La lectura de `get_campaign_count` en el contrato desplegado devolvió `1`.

## Verificación de código

Comandos ejecutados:

```powershell
stellar contract build
stellar contract bindings typescript --wasm target\wasm32v1-none\release\donations.wasm --output-dir packages\sdk --overwrite
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
bash -n scripts/deploy.sh
bash -n scripts/setup-tokens.sh
pnpm --filter @clearfun/scripts smoke-test
```

Resultados:

- El contrato se desplegó e inicializó en Testnet.
- `pnpm install --frozen-lockfile`: correcto.
- Los builds TypeScript de `@clearfun/sdk` y `@clearfun/scripts`: correctos.
- Las suites de backend, ESLint, Prettier y la sintaxis Bash: correctas.
- El smoke test Testnet completó todas las transacciones y la aserción del
  saldo de la organización.
- El SAC XLM existente respondió con `name = "native"`; el script persistió su
  ID sin intentar desplegar un contrato reservado que ya existía.

Los secretos de prueba se crearon para el proceso, se financiaron por Friendbot
y no se guardaron en el repositorio ni en `.env`.
