# API del contrato Soroban ClearFund

Contrato: `donations`, Soroban SDK 28. El contrato nuevo usa un almacenamiento
vacío; las campañas del contrato previo siguen siendo legacy y no se migran.
Montos e índices se expresan en unidades mínimas del token e índices desde 0.

## Tipos principales

- `CampaignStatus`: `Active`, `Completed`, `Expired`, `Cancelled`.
- `BondState`: `Held`, `Returned`, `Slashed`.
- `MilestoneStatus`: `Pending`, `EvidenceSubmitted`, `Released`.
- `Campaign`: `id`, `org`, `token`, `title`, `description_uri`, `goal`,
  `deadline`, `window_secs`, `bond_amount`, `bond_state`, `total_raised`,
  `total_released`, `total_withdrawn`, `held`, `total_shares`, `epoch`,
  `status`, `milestones`.
- `Milestone`: `description`, `amount`, `status`, `evidence_hash` (32 bytes),
  `evidence_uri`, `window_end`, `released_amount`.
- `Position`: `contributed`, `shares`, `epoch`, `withdrawn`.
- `get_position(campaign_id, donor)` devuelve
  `{ contributed, shares, value, withdrawn }`. Si la época de la posición no
  coincide con la campaña, `shares` y `value` se exponen como cero.

## Contabilidad de participaciones

- Donación `x`: si `S==0`, `shares=x`; en otro caso `shares=x*S/H`. Se
  rechaza el resultado de cero participaciones. H aumenta en `x`.
- Valor actual: `shares*H/S`, o cero si S es cero.
- Liberación `A`: reduce H, mantiene las participaciones. El pago es
  `min(milestone.amount, held)`.
- Retiro: transfiere todo el valor de esa posición y quema sus participaciones.
- Si H llega a cero, `S=0` y `epoch` aumenta; las posiciones viejas valen
  cero.
- Todos los productos, sumas y restas monetarios usan aritmética checked.
  La división entera trunca hacia abajo; el polvo máximo por división es menor
  que una unidad base por operación.

## Funciones

| Método | Autorización y reglas |
| --- | --- |
| `initialize(bond_bps, initializer)` | Una sola vez, `initializer.require_auth()`, `0..=5000`. El argumento `initializer` es explícito para autenticar la inicialización; no queda como administrador ni obtiene privilegios posteriores. |
| `create_campaign(org, token, title, description_uri, milestones, window_secs, deadline) -> u32` | `org.require_auth()`. Al menos un hito positivo; `window_secs` entre 60 y 2.592.000; deadline futuro y no mayor a 365 días; goal es suma checked. Garantía `ceil(goal*bond_bps/10000)`, mínimo 1 cuando el BPS es positivo. La organización la transfiere al contrato. |
| `donate(donor, campaign_id, amount)` | Donante autenticado; activa, antes del deadline, monto positivo; la organización no puede donar a su campaña; `held+total_released+amount <= goal`, si no `ExceedsGoal`. |
| `submit_evidence(campaign_id, milestone_index, evidence_hash, evidence_uri)` | Autentica a la organización. Hito activo y pendiente; anteriores Released; `held >= milestone.amount`; ventana completa no puede sobrepasar el deadline. Marca `EvidenceSubmitted` y `window_end=ahora+window_secs`. |
| `withdraw(donor, campaign_id) -> i128` | Autentica al donante; retira todo su valor si una ventana está abierta (`ahora < window_end`) o después del deadline, sin campaña Completed y sin hito cuya ventana venció pendiente de liberar. Este último caso da `ReleasePending`. Al primer retiro post-deadline, una garantía Held con participaciones se confisca y se reparte proporcionalmente. |
| `release_milestone(campaign_id, milestone_index)` | Pública. Requiere evidencia presentada, ventana vencida y `held>0`. Si libera todos los hitos, marca Completed y devuelve la garantía. No se puede repetir. |
| `reclaim_bond(campaign_id)` | Autentica a la organización; solo después del deadline, no completada, `total_shares==0` y garantía Held. |
| `cancel_campaign(campaign_id)` | Autentica a la organización; solo Active y sin donaciones (`total_raised==0`). Devuelve la garantía. |
| `get_campaign(campaign_id)` | Getter público de campaña. |
| `get_campaign_count()` | Getter público; IDs comienzan en 1. |
| `get_milestone(campaign_id, milestone_index)` | Getter público de hito. |
| `get_position(campaign_id, donor)` | Getter público del estado de una posición y valor actual. |
| `get_config()` | Getter público; devuelve BPS configurados. |

No existen admin posterior, verificadores, umbrales, votos, aprobaciones ni
disputas. La salida solo devuelve la participación individual; no hay reembolso
global ni congelamiento decidido por un tercero.

## Errores estables

| Código | Error | Descripción en español |
| ---: | --- | --- |
| 1 | `AlreadyInitialized` | El contrato ya fue inicializado. |
| 2 | `NotInitialized` | El contrato todavía no fue inicializado. |
| 3 | `CampaignNotFound` | No existe la campaña indicada. |
| 4 | `InvalidCampaign` | Los datos de la campaña o la evidencia no son válidos. |
| 5 | `InvalidMilestone` | No existe el hito indicado. |
| 6 | `InvalidAmount` | El monto debe ser positivo y válido. |
| 7 | `InvalidDeadline` | El deadline no está en el intervalo permitido. |
| 8 | `CampaignNotActive` | La campaña no está activa para esta acción. |
| 9 | `CampaignExpired` | La campaña venció y no admite donaciones. |
| 10 | `InvalidMilestoneOrder` | Los hitos anteriores no se liberaron. |
| 11 | `InvalidMilestoneStatus` | El hito no está en un estado que permita esta acción. |
| 12 | `ArithmeticOverflow` | Una operación aritmética excedería su rango. |
| 13 | `ExceedsGoal` | La donación superaría la meta financiable. |
| 14 | `OrganizationCannotDonate` | La organización no puede donar a su propia campaña. |
| 15 | `NotFunded` | No hay fondos suficientes para presentar o liberar el hito. |
| 16 | `WindowNotOpen` | La ventana aún no venció o no hay ventana de retiro abierta. |
| 17 | `ReleasePending` | Hay un hito cuya ventana venció y debe liberarse antes del retiro. |
| 18 | `NothingToWithdraw` | La posición no tiene valor retirable. |
| 19 | `BondUnavailable` | La garantía no cumple las condiciones de recuperación. |
| 20 | `InvalidWindow` | La ventana no está entre 60 y 2.592.000 segundos. |
| 21 | `ZeroShares` | La cantidad no generaría participaciones. |

## Eventos

Los nueve eventos incluyen `campaign_id` como primer identificador indexado.

| Evento | Datos relevantes | Etiqueta sugerida en español |
| --- | --- | --- |
| `campaign_created` | organización, token, meta, deadline | Campaña creada |
| `donated` | donante, monto, participaciones | Donación recibida |
| `evidence_submitted` | hito, hash, URI, fin de ventana | Evidencia publicada; ventana abierta |
| `exited` | donante, monto, participaciones quemadas | Donante retiró su parte |
| `milestone_released` | hito, organización, monto | Etapa liberada |
| `campaign_completed` | total liberado | Campaña completada |
| `bond_returned` | organización, monto | Garantía devuelta |
| `bond_slashed` | monto confiscado | Garantía añadida al fondo de salida |
| `campaign_cancelled` | organización | Campaña cancelada |

## Storage y despliegue

Las claves de configuración, campaña y posición están en persistent storage;
las lecturas y escrituras extienden el TTL de cada entrada consultada. El count
usa instance storage y extiende su TTL. Las transferencias de token ocurren
después de actualizar storage; Soroban revierte el estado si la llamada al
token falla.
