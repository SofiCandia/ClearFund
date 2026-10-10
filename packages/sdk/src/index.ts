import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"CampaignNotFound"},
  4: {message:"InvalidCampaign"},
  5: {message:"InvalidMilestone"},
  6: {message:"InvalidAmount"},
  7: {message:"InvalidDeadline"},
  8: {message:"CampaignNotActive"},
  9: {message:"CampaignExpired"},
  10: {message:"InvalidMilestoneOrder"},
  11: {message:"InvalidMilestoneStatus"},
  12: {message:"ArithmeticOverflow"},
  13: {message:"ExceedsGoal"},
  14: {message:"OrganizationCannotDonate"},
  15: {message:"NotFunded"},
  16: {message:"WindowNotOpen"},
  17: {message:"ReleasePending"},
  18: {message:"NothingToWithdraw"},
  19: {message:"BondUnavailable"},
  20: {message:"InvalidWindow"},
  21: {message:"ZeroShares"}
}




export interface Campaign {
  bond_amount: i128;
  bond_state: BondState;
  deadline: u64;
  description_uri: string;
  epoch: u32;
  goal: i128;
  held: i128;
  id: u32;
  milestones: Array<Milestone>;
  org: string;
  status: CampaignStatus;
  title: string;
  token: string;
  total_raised: i128;
  total_released: i128;
  total_shares: i128;
  total_withdrawn: i128;
  window_secs: u64;
}

export type BondState = {tag: "Held", values: void} | {tag: "Returned", values: void} | {tag: "Slashed", values: void};


export interface Milestone {
  amount: i128;
  description: string;
  evidence_hash: Buffer;
  evidence_uri: string;
  released_amount: i128;
  status: MilestoneStatus;
  window_end: u64;
}



export interface PositionView {
  contributed: i128;
  shares: i128;
  value: i128;
  withdrawn: i128;
}


export type CampaignStatus = {tag: "Active", values: void} | {tag: "Completed", values: void} | {tag: "Expired", values: void} | {tag: "Cancelled", values: void};

export type MilestoneStatus = {tag: "Pending", values: void} | {tag: "EvidenceSubmitted", values: void} | {tag: "Released", values: void};






export interface Client {
  /**
   * Construct and simulate a donate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  donate: ({donor, campaign_id, amount}: {donor: string, campaign_id: u32, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw: ({donor, campaign_id}: {donor: string, campaign_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({bond_bps, initializer}: {bond_bps: u32, initializer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_campaign: ({campaign_id}: {campaign_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Campaign>>>

  /**
   * Construct and simulate a get_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_position: ({campaign_id, donor}: {campaign_id: u32, donor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PositionView>>>

  /**
   * Construct and simulate a reclaim_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reclaim_bond: ({campaign_id}: {campaign_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_milestone: ({campaign_id, milestone_index}: {campaign_id: u32, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Milestone>>>

  /**
   * Construct and simulate a cancel_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_campaign: ({campaign_id}: {campaign_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_campaign: ({org, token, title, description_uri, milestones, window_secs, deadline}: {org: string, token: string, title: string, description_uri: string, milestones: Array<readonly [string, i128]>, window_secs: u64, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a submit_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_evidence: ({campaign_id, milestone_index, evidence_hash, evidence_uri}: {campaign_id: u32, milestone_index: u32, evidence_hash: Buffer, evidence_uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a release_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  release_milestone: ({campaign_id, milestone_index}: {campaign_id: u32, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_campaign_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_campaign_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAQQ2FtcGFpZ25Ob3RGb3VuZAAAAAMAAAAAAAAAD0ludmFsaWRDYW1wYWlnbgAAAAAEAAAAAAAAABBJbnZhbGlkTWlsZXN0b25lAAAABQAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAYAAAAAAAAAD0ludmFsaWREZWFkbGluZQAAAAAHAAAAAAAAABFDYW1wYWlnbk5vdEFjdGl2ZQAAAAAAAAgAAAAAAAAAD0NhbXBhaWduRXhwaXJlZAAAAAAJAAAAAAAAABVJbnZhbGlkTWlsZXN0b25lT3JkZXIAAAAAAAAKAAAAAAAAABZJbnZhbGlkTWlsZXN0b25lU3RhdHVzAAAAAAALAAAAAAAAABJBcml0aG1ldGljT3ZlcmZsb3cAAAAAAAwAAAAAAAAAC0V4Y2VlZHNHb2FsAAAAAA0AAAAAAAAAGE9yZ2FuaXphdGlvbkNhbm5vdERvbmF0ZQAAAA4AAAAAAAAACU5vdEZ1bmRlZAAAAAAAAA8AAAAAAAAADVdpbmRvd05vdE9wZW4AAAAAAAAQAAAAAAAAAA5SZWxlYXNlUGVuZGluZwAAAAAAEQAAAAAAAAARTm90aGluZ1RvV2l0aGRyYXcAAAAAAAASAAAAAAAAAA9Cb25kVW5hdmFpbGFibGUAAAAAEwAAAAAAAAANSW52YWxpZFdpbmRvdwAAAAAAABQAAAAAAAAAClplcm9TaGFyZXMAAAAAABU=",
        "AAAABQAAAAAAAAAAAAAABkV4aXRlZAAAAAAAAQAAAAZleGl0ZWQAAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAAVkb25vcgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAB0RvbmF0ZWQAAAAAAQAAAAdkb25hdGVkAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAAVkb25vcgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAZzaGFyZXMAAAAAAAsAAAAAAAAAAg==",
        "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",
        "AAAABQAAAAAAAAAAAAAAEUV2aWRlbmNlU3VibWl0dGVkAAAAAAAAAQAAABJldmlkZW5jZV9zdWJtaXR0ZWQAAAAAAAYAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAAA29yZwAAAAATAAAAAAAAAAAAAAANZXZpZGVuY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAAAAAAMZXZpZGVuY2VfdXJpAAAAEAAAAAAAAAAAAAAACndpbmRvd19lbmQAAAAAAAYAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZVJlbGVhc2VkAAAAAAAAAQAAABJtaWxlc3RvbmVfcmVsZWFzZWQAAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAAA29yZwAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAAGZG9uYXRlAAAAAAADAAAAAAAAAAVkb25vcgAAAAAAABMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAACAAAAAAAAAAVkb25vcgAAAAAAABMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAABAAAAAM=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAIYm9uZF9icHMAAAAEAAAAAAAAAAtpbml0aWFsaXplcgAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMZ2V0X2NhbXBhaWduAAAAAQAAAAAAAAALY2FtcGFpZ25faWQAAAAABAAAAAEAAAPpAAAH0AAAAAhDYW1wYWlnbgAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X3Bvc2l0aW9uAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABAAAAAAAAAAFZG9ub3IAAAAAAAATAAAAAQAAA+kAAAfQAAAADFBvc2l0aW9uVmlldwAAAAM=",
        "AAAAAAAAAAAAAAAMcmVjbGFpbV9ib25kAAAAAQAAAAAAAAALY2FtcGFpZ25faWQAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANZ2V0X21pbGVzdG9uZQAAAAAAAAIAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAA+kAAAfQAAAACU1pbGVzdG9uZQAAAAAAAAM=",
        "AAAAAAAAAAAAAAAPY2FuY2VsX2NhbXBhaWduAAAAAAEAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAPY3JlYXRlX2NhbXBhaWduAAAAAAcAAAAAAAAAA29yZwAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABXRpdGxlAAAAAAAAEAAAAAAAAAAPZGVzY3JpcHRpb25fdXJpAAAAABAAAAAAAAAACm1pbGVzdG9uZXMAAAAAA+oAAAPtAAAAAgAAABAAAAALAAAAAAAAAAt3aW5kb3dfc2VjcwAAAAAGAAAAAAAAAAhkZWFkbGluZQAAAAYAAAABAAAD6QAAAAQAAAAD",
        "AAAAAAAAAAAAAAAPc3VibWl0X2V2aWRlbmNlAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAADGV2aWRlbmNlX3VyaQAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAARcmVsZWFzZV9taWxlc3RvbmUAAAAAAAACAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAEAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAASZ2V0X2NhbXBhaWduX2NvdW50AAAAAAAAAAAAAQAAAAQ=" ]),
      options
    )
  }
  public readonly fromJSON = {
    donate: this.txFromJSON<Result<void>>,
        withdraw: this.txFromJSON<Result<i128>>,
        get_config: this.txFromJSON<Result<u32>>,
        initialize: this.txFromJSON<Result<void>>,
        get_campaign: this.txFromJSON<Result<Campaign>>,
        get_position: this.txFromJSON<Result<PositionView>>,
        reclaim_bond: this.txFromJSON<Result<void>>,
        get_milestone: this.txFromJSON<Result<Milestone>>,
        cancel_campaign: this.txFromJSON<Result<void>>,
        create_campaign: this.txFromJSON<Result<u32>>,
        submit_evidence: this.txFromJSON<Result<void>>,
        release_milestone: this.txFromJSON<Result<void>>,
        get_campaign_count: this.txFromJSON<u32>
  }
}