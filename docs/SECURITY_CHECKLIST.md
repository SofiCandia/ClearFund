# Checklist de seguridad

Esta revisión documenta controles de código y tests; no sustituye una auditoría
externa ni habilita fondos de valor. El despliegue es para Testnet.

## Controles del contrato nuevo

| Control | Estado | Evidencia |
| --- | --- | --- |
| Inicialización única y autenticada | ✅ Implementado | BPS `0..=5000`, dirección initializer explícita autenticada; no hay admin posterior. |
| Auth de cada actor | ✅ Implementado | Organización y donantes autentican sus acciones; liberación es pública intencionalmente. |
| Estado antes de transferencias | ✅ Implementado | Storage se actualiza antes de cada llamada al token; Soroban proporciona rollback atómico. |
| Aritmética monetaria checked | ✅ Implementado | Sumas, restas y productos checked; bond con redondeo hacia arriba. |
| Prevención del excedente | ✅ Resuelto | `ExceedsGoal` impide que `held + total_released + aporte` supere la meta. |
| Donación de la organización | ✅ Resuelto | `OrganizationCannotDonate` impide financiar su campaña desde la wallet organizadora. |
| Participaciones y salida individual | ✅ Implementado | Valor `shares*held/total_shares`, quema individual y reset de época al llegar H a cero. |
| Ventana, orden de hitos y NotFunded | ✅ Implementado | Evidencia solo para el siguiente hito financiado; retiro bloqueado por `ReleasePending`. |
| TTL de persistent storage | ✅ Implementado | Cada entrada persistent leída o escrita extiende TTL; count extiende instance TTL. |
| Eventos nuevos e idempotencia | ✅ Implementado | Indexer filtra el contrato activo, guarda hash/link y deduplica por event ID. |
| Datos legacy separados | ✅ Implementado | `LEGACY_CONTRACT_ID`; DB activa nueva y sin campañas legacy. |
| Secretos en scripts | ✅ Controlado | Los scripts no imprimen valores de `.env`; seed y smoke solo imprimen hash/link y estado. |

## Limitaciones explícitas

- El silencio durante la ventana pública equivale a aceptar: al vencer, cualquier
  cuenta puede liberar el hito.
- Una evidencia falsa, pero convincente, puede engañar. El hash acredita
  integridad de bytes, no veracidad de lo descrito.
- No hay verificadores, admin, aprobaciones, ni proceso de disputas; por ello
  tampoco existe un veto humano on-chain.
- La garantía se limita al BPS fijado al inicializar (máximo 50%) y no equivale
  a cubrir una estafa grande.
- Las divisiones enteras truncan; el polvo puede ser irrecuperable. Cada
  operación pierde menos de una unidad base por división, pero pérdidas
  acumuladas requieren revisar la secuencia de operaciones.
- Un token no estándar puede comportarse distinto; el contrato no aplica una
  allowlist de SAC/token.
- SQLite, almacenamiento local de evidencia, RPC público y Testnet no ofrecen
  garantías de producción. Una interrupción mayor que la retención del RPC
  exige una estrategia de recuperación.
- El deploy y el smoke-test nuevos siguen pendientes hasta disponer de una
  cuenta de despliegue financiada y credenciales de las cuentas demo.

## Antes de usar fondos de valor

- [ ] Desplegar contrato nuevo desde una cuenta protegida; inicializar BPS y
      verificar la transacción de inicialización.
- [ ] Ejecutar smoke y seed con cuentas desechables de Testnet.
- [ ] Auditoría externa del contrato, aritmética, authorization entries,
      tokens admitidos y TTL.
- [ ] Añadir pruebas de propiedades/fuzzing para reparto, épocas, polvo y
      concurrencia de retiros/liberaciones.
- [ ] Desplegar backend con almacenamiento durable, copias de seguridad,
      monitorización, límites de relay y CORS exacto.
- [ ] Revisar privacidad, evidencia, marco legal y respuesta a incidentes.
