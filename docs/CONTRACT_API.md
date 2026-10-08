# ClearFun Soroban Contract API

Contract crate: `donations`  
Source: [`contracts/donations/src/lib.rs`](../contracts/donations/src/lib.rs)  
SDK: Soroban SDK 28

All amounts are token base units (the integer units expected by the Stellar
Asset Contract or other Soroban token contract). Milestone indices are
zero-based. The token address is the address of a standard Soroban token
contract, including a Stellar Asset Contract for XLM or issued assets.

## Types

- `CampaignStatus`: `Active`, `Completed`, `Expired`, `Cancelled`.
- `MilestoneStatus`: `Pending`, `EvidenceSubmitted`, `Released`.
- `Campaign`: ID, organization and token addresses, title and description URI,
  goal/deadline, verifier set and threshold, raised/released totals, status,
  and milestones.
- `Milestone`: description, amount, status, SHA-256 evidence digest, evidence
  URI, and the addresses that approved it.
- `Error`: contract errors with stable numeric codes. Public methods return
  `Result<_, Error>` where rejection is possible.

| Code | Error |
| --- | --- |
| 1 | `AlreadyInitialized` |
| 2 | `NotInitialized` |
| 3 | `CampaignNotFound` |
| 4 | `InvalidCampaign` |
| 5 | `InvalidMilestone` |
| 6 | `InvalidAmount` |
| 7 | `InvalidThreshold` |
| 8 | `InvalidDeadline` |
| 9 | `DuplicateVerifier` |
| 10 | `OrganizationCannotVerify` |
| 11 | `CampaignNotActive` |
| 12 | `CampaignExpired` |
| 13 | `InvalidMilestoneOrder` |
| 14 | `InvalidMilestoneStatus` |
| 15 | `NotVerifier` |
| 16 | `AlreadyApproved` |
| 17 | `AlreadyRefunded` |
| 18 | `NothingToRefund` |
| 19 | `NoRefundDue` |
| 20 | `ArithmeticOverflow` |

## Public functions

| Function | Authorization and behavior |
| --- | --- |
| `initialize(admin)` | One-time initialization; `admin` must authorize. |
| `create_campaign(org, token, title, description_uri, milestones, verifiers, threshold, deadline) -> u32` | `org` authorizes. Requires a future deadline, non-empty title/URI/milestones, positive milestone amounts, unique verifiers other than the organization, and `1 <= threshold <= verifiers.len()`. Goal is the checked sum of milestone amounts. |
| `donate(donor, campaign_id, amount)` | `donor` authorizes. Accepts positive amounts only while the campaign is active and before its deadline. Transfers tokens into escrow and adds to the donor's cumulative donation. |
| `submit_evidence(campaign_id, milestone_index, evidence_hash, evidence_uri)` | Organization authorizes. Only a pending milestone may be submitted, and all earlier milestones must already be released. Evidence URI must be non-empty. |
| `approve_milestone(verifier, campaign_id, milestone_index)` | `verifier` authorizes and must be an assigned verifier. Each verifier can approve once. Reaching the threshold releases automatically when campaign-raised and on-contract token balances can fund the milestone. |
| `release_milestone(campaign_id, milestone_index)` | Public. Completes a threshold-approved evidence-submitted milestone when funds are available. |
| `claim_refund(donor, campaign_id) -> i128` | `donor` authorizes. Available at/after the deadline unless the campaign is completed or cancelled. One claim per donor. |
| `cancel_campaign(campaign_id)` | Organization authorizes. Allowed only while active and before any funds have been raised. |
| `get_campaign(id) -> Campaign` | Reads a campaign or returns `CampaignNotFound`. |
| `get_campaign_count() -> u32` | Returns the number of campaigns created. IDs start at 1. |
| `get_donation(campaign_id, donor) -> i128` | Returns that donor's cumulative contributions, or zero. |
| `get_milestone(campaign_id, index) -> Milestone` | Reads a milestone or returns `InvalidMilestone`. |

## Refund and release accounting

The refundable pool is `total_raised - total_released`. Each donor can claim
`floor(donor_contribution * refundable_pool / total_raised)`. Checked
multiplication, subtraction, and division reject arithmetic overflow. A claim
that rounds down to zero is rejected without consuming the donor's claim.
Integer rounding can leave a small residual amount in escrow.

Milestone releases cannot exceed the campaign's still-unreleased raised amount,
even if unrelated tokens were transferred directly to the contract. An
insufficient campaign allocation or token balance leaves approvals recorded
and the milestone pending release for a later public `release_milestone` call.
After the first refund, campaign status becomes `Expired` and no further
milestone release is allowed, protecting the remaining claimants' pool.

State is written before each external token transfer. Soroban transaction
atomicity reverts the state change if the token transfer fails.

## Events

Events are declared with Soroban `#[contractevent]` types so their schemas are
present in the contract spec. Each event has the named event as its first
topic, followed by indexed identifiers:

| Event | Indexed topics | Event data |
| --- | --- | --- |
| `campaign_created` | `campaign_id` | `org`, `token`, `goal`, `deadline` |
| `donated` | `campaign_id`, `donor` | `amount`, `total_raised` |
| `evidence_submitted` | `campaign_id`, `milestone_index` | `org`, `evidence_hash`, `evidence_uri` |
| `milestone_approved` | `campaign_id`, `milestone_index`, `verifier` | `approvals_count` |
| `milestone_released` | `campaign_id`, `milestone_index` | `org`, `amount` |
| `refund_claimed` | `campaign_id`, `donor` | `amount` |
| `campaign_completed` | `campaign_id`, `org` | `total_released` |
| `campaign_cancelled` | `campaign_id`, `org` | No additional data |

## Storage lifetime

Campaign, donation, refund-marker, and initialization records use persistent
storage. Reads and writes extend accessed persistent entries when their
remaining TTL falls below 100,000 ledgers, setting the target TTL to 518,400
ledgers. Campaign creation and count access also extend instance storage.
Applications/operators should periodically access live campaigns and keep
contract-instance TTL alive according to Stellar's storage rent rules.
