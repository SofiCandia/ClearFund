# Fase 1: Contrato Soroban de escrow por hitos

## Qué se hizo

- Implementado el contrato Soroban en `contracts/donations`: inicialización,
  creación de campañas, donaciones tokenizadas, evidencia, aprobaciones M-de-N,
  liberación automática o posterior, reembolsos proporcionales, cancelación y
  getters.
- Añadidos tipos de campaña/hito y errores de contrato con códigos explícitos.
- Añadidos eventos tipados Soroban para las ocho transiciones requeridas, con
  identificadores y direcciones indexables.
- Añadido storage persistente con extensión de TTL al leer y escribir los
  registros.
- Incluidas 12 pruebas con Soroban `testutils`, cubriendo el flujo feliz,
  threshold 2-de-3, autorización, aprobaciones duplicadas, verificador
  inválido, vencimiento, reembolsos proporcionales, liberación única, orden de
  hitos, cancelación y fondos insuficientes.
- Documentada la superficie y semántica pública en
  [`CONTRACT_API.md`](./CONTRACT_API.md).

## Verificación

Comandos ejecutados desde la raíz:

```powershell
cargo fmt --all
cargo test -p donations
stellar contract build
```

Resultados:

- `cargo test -p donations`: 12 pasaron, 0 fallaron.
- `stellar contract build`: correcto; generó
  `target/wasm32v1-none/release/donations.wasm` (19,031 bytes optimizado).
- La CLI reportó las 12 funciones públicas esperadas en el contrato.

## Decisiones de implementación

- Se sigue la interfaz estándar Soroban `token::Client` para transferir y
  consultar saldos, de modo que el token puede ser un Stellar Asset Contract
  de XLM/USDC u otro contrato SEP-41 compatible.
- El umbral se registra sin liberar prematuramente; cuando se alcanza, la
  liberación automática ocurre solo si la asignación todavía no liberada y el
  saldo del contrato alcanzan el monto. De lo contrario, `release_milestone`
  permite reintentar.
- La primera reclamación válida marca la campaña `Expired`; después no se
  liberan hitos, para no consumir el pool disponible para otros donantes.
- El reembolso usa división entera hacia abajo y una multiplicación checked;
  el residuo de redondeo permanece en escrow. Una reclamación redondeada a cero
  se rechaza sin marcar al donante como reembolsado.
- La campaña se marca `Completed` cuando el total liberado alcanza el objetivo
  (suma de los hitos). Una campaña con fecha vencida mantiene el status previo
  hasta que se ejecute una reclamación de reembolso.
- Los estados se escriben antes de las transferencias token; un fallo del token
  revierte la transacción completa en Soroban.
- El TTL persistente se extiende a 518,400 ledgers al acceder a cada registro;
  las operaciones de aplicación deben mantener vivas las campañas activas y
  seguir las reglas de rent/TTL de la red.
