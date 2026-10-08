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
  7: {message:"InvalidThreshold"},
  8: {message:"InvalidDeadline"},
  9: {message:"DuplicateVerifier"},
  10: {message:"OrganizationCannotVerify"},
  11: {message:"CampaignNotActive"},
  12: {message:"CampaignExpired"},
  13: {message:"InvalidMilestoneOrder"},
  14: {message:"InvalidMilestoneStatus"},
  15: {message:"NotVerifier"},
  16: {message:"AlreadyApproved"},
  17: {message:"AlreadyRefunded"},
  18: {message:"NothingToRefund"},
  19: {message:"NoRefundDue"},
  20: {message:"ArithmeticOverflow"}
}



export interface Campaign {
  deadline: u64;
  description_uri: string;
  goal: i128;
  id: u32;
  milestones: Array<Milestone>;
  org: string;
  status: CampaignStatus;
  threshold: u32;
  title: string;
  token: string;
  total_raised: i128;
  total_released: i128;
  verifiers: Array<string>;
}


export interface Milestone {
  amount: i128;
  approvals: Array<string>;
  description: string;
  evidence_hash: Buffer;
  evidence_uri: string;
  status: MilestoneStatus;
}


export type CampaignStatus = {tag: "Active", values: void} | {tag: "Completed", values: void} | {tag: "Expired", values: void} | {tag: "Cancelled", values: void};

export type MilestoneStatus = {tag: "Pending", values: void} | {tag: "EvidenceSubmitted", values: void} | {tag: "Released", values: void};







export interface Client {
  /**
   * Construct and simulate a donate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  donate: ({donor, campaign_id, amount}: {donor: string, campaign_id: u32, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_refund: ({donor, campaign_id}: {donor: string, campaign_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_campaign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_campaign: ({campaign_id}: {campaign_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Campaign>>>

  /**
   * Construct and simulate a get_donation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_donation: ({campaign_id, donor}: {campaign_id: u32, donor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

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
  create_campaign: ({org, token, title, description_uri, milestones, verifiers, threshold, deadline}: {org: string, token: string, title: string, description_uri: string, milestones: Array<readonly [string, i128]>, verifiers: Array<string>, threshold: u32, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a submit_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_evidence: ({campaign_id, milestone_index, evidence_hash, evidence_uri}: {campaign_id: u32, milestone_index: u32, evidence_hash: Buffer, evidence_uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve_milestone: ({verifier, campaign_id, milestone_index}: {verifier: string, campaign_id: u32, milestone_index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAQQ2FtcGFpZ25Ob3RGb3VuZAAAAAMAAAAAAAAAD0ludmFsaWRDYW1wYWlnbgAAAAAEAAAAAAAAABBJbnZhbGlkTWlsZXN0b25lAAAABQAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAYAAAAAAAAAEEludmFsaWRUaHJlc2hvbGQAAAAHAAAAAAAAAA9JbnZhbGlkRGVhZGxpbmUAAAAACAAAAAAAAAARRHVwbGljYXRlVmVyaWZpZXIAAAAAAAAJAAAAAAAAABhPcmdhbml6YXRpb25DYW5ub3RWZXJpZnkAAAAKAAAAAAAAABFDYW1wYWlnbk5vdEFjdGl2ZQAAAAAAAAsAAAAAAAAAD0NhbXBhaWduRXhwaXJlZAAAAAAMAAAAAAAAABVJbnZhbGlkTWlsZXN0b25lT3JkZXIAAAAAAAANAAAAAAAAABZJbnZhbGlkTWlsZXN0b25lU3RhdHVzAAAAAAAOAAAAAAAAAAtOb3RWZXJpZmllcgAAAAAPAAAAAAAAAA9BbHJlYWR5QXBwcm92ZWQAAAAAEAAAAAAAAAAPQWxyZWFkeVJlZnVuZGVkAAAAABEAAAAAAAAAD05vdGhpbmdUb1JlZnVuZAAAAAASAAAAAAAAAAtOb1JlZnVuZER1ZQAAAAATAAAAAAAAABJBcml0aG1ldGljT3ZlcmZsb3cAAAAAABQ=",
        "AAAABQAAAAAAAAAAAAAAB0RvbmF0ZWQAAAAAAQAAAAdkb25hdGVkAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAAVkb25vcgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAx0b3RhbF9yYWlzZWQAAAALAAAAAAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAACENhbXBhaWduAAAADQAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAA9kZXNjcmlwdGlvbl91cmkAAAAAEAAAAAAAAAAEZ29hbAAAAAsAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAptaWxlc3RvbmVzAAAAAAPqAAAH0AAAAAlNaWxlc3RvbmUAAAAAAAAAAAAAA29yZwAAAAATAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAOQ2FtcGFpZ25TdGF0dXMAAAAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRvdGFsX3JhaXNlZAAAAAsAAAAAAAAADnRvdGFsX3JlbGVhc2VkAAAAAAALAAAAAAAAAAl2ZXJpZmllcnMAAAAAAAPqAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAACU1pbGVzdG9uZQAAAAAAAAYAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAJYXBwcm92YWxzAAAAAAAD6gAAABMAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADWV2aWRlbmNlX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAMZXZpZGVuY2VfdXJpAAAAEAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAD01pbGVzdG9uZVN0YXR1cwA=",
        "AAAABQAAAAAAAAAAAAAADVJlZnVuZENsYWltZWQAAAAAAAABAAAADnJlZnVuZF9jbGFpbWVkAAAAAAADAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAEAAAAAQAAAAAAAAAFZG9ub3IAAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAAAgAAAAAAAAAAAAAADkNhbXBhaWduU3RhdHVzAAAAAAAEAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAlDb21wbGV0ZWQAAAAAAAAAAAAAAAAAAAdFeHBpcmVkAAAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAA==",
        "AAAAAgAAAAAAAAAAAAAAD01pbGVzdG9uZVN0YXR1cwAAAAADAAAAAAAAAAAAAAAHUGVuZGluZwAAAAAAAAAAAAAAABFFdmlkZW5jZVN1Ym1pdHRlZAAAAAAAAAAAAAAAAAAACFJlbGVhc2Vk",
        "AAAABQAAAAAAAAAAAAAAD0NhbXBhaWduQ3JlYXRlZAAAAAABAAAAEGNhbXBhaWduX2NyZWF0ZWQAAAAFAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAEAAAAAQAAAAAAAAADb3JnAAAAABMAAAAAAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAARnb2FsAAAACwAAAAAAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEUNhbXBhaWduQ2FuY2VsbGVkAAAAAAAAAQAAABJjYW1wYWlnbl9jYW5jZWxsZWQAAAAAAAIAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAANvcmcAAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAAEUNhbXBhaWduQ29tcGxldGVkAAAAAAAAAQAAABJjYW1wYWlnbl9jb21wbGV0ZWQAAAAAAAMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAANvcmcAAAAAEwAAAAEAAAAAAAAADnRvdGFsX3JlbGVhc2VkAAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEUV2aWRlbmNlU3VibWl0dGVkAAAAAAAAAQAAABJldmlkZW5jZV9zdWJtaXR0ZWQAAAAAAAUAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAAA29yZwAAAAATAAAAAAAAAAAAAAANZXZpZGVuY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAAAAAAMZXZpZGVuY2VfdXJpAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZUFwcHJvdmVkAAAAAAAAAQAAABJtaWxlc3RvbmVfYXBwcm92ZWQAAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAACHZlcmlmaWVyAAAAEwAAAAEAAAAAAAAAD2FwcHJvdmFsc19jb3VudAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZVJlbGVhc2VkAAAAAAAAAQAAABJtaWxlc3RvbmVfcmVsZWFzZWQAAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAAAAAAAA29yZwAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAAGZG9uYXRlAAAAAAADAAAAAAAAAAVkb25vcgAAAAAAABMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMY2xhaW1fcmVmdW5kAAAAAgAAAAAAAAAFZG9ub3IAAAAAAAATAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAEAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAMZ2V0X2NhbXBhaWduAAAAAQAAAAAAAAALY2FtcGFpZ25faWQAAAAABAAAAAEAAAPpAAAH0AAAAAhDYW1wYWlnbgAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X2RvbmF0aW9uAAAAAgAAAAAAAAALY2FtcGFpZ25faWQAAAAABAAAAAAAAAAFZG9ub3IAAAAAAAATAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAANZ2V0X21pbGVzdG9uZQAAAAAAAAIAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAA+kAAAfQAAAACU1pbGVzdG9uZQAAAAAAAAM=",
        "AAAAAAAAAAAAAAAPY2FuY2VsX2NhbXBhaWduAAAAAAEAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAPY3JlYXRlX2NhbXBhaWduAAAAAAgAAAAAAAAAA29yZwAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABXRpdGxlAAAAAAAAEAAAAAAAAAAPZGVzY3JpcHRpb25fdXJpAAAAABAAAAAAAAAACm1pbGVzdG9uZXMAAAAAA+oAAAPtAAAAAgAAABAAAAALAAAAAAAAAAl2ZXJpZmllcnMAAAAAAAPqAAAAEwAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAQAAA+kAAAAEAAAAAw==",
        "AAAAAAAAAAAAAAAPc3VibWl0X2V2aWRlbmNlAAAAAAQAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAAAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAADGV2aWRlbmNlX3VyaQAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAARYXBwcm92ZV9taWxlc3RvbmUAAAAAAAADAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAAC2NhbXBhaWduX2lkAAAAAAQAAAAAAAAAD21pbGVzdG9uZV9pbmRleAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAARcmVsZWFzZV9taWxlc3RvbmUAAAAAAAACAAAAAAAAAAtjYW1wYWlnbl9pZAAAAAAEAAAAAAAAAA9taWxlc3RvbmVfaW5kZXgAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAASZ2V0X2NhbXBhaWduX2NvdW50AAAAAAAAAAAAAQAAAAQ=" ]),
      options
    )
  }
  public readonly fromJSON = {
    donate: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        claim_refund: this.txFromJSON<Result<i128>>,
        get_campaign: this.txFromJSON<Result<Campaign>>,
        get_donation: this.txFromJSON<Result<i128>>,
        get_milestone: this.txFromJSON<Result<Milestone>>,
        cancel_campaign: this.txFromJSON<Result<void>>,
        create_campaign: this.txFromJSON<Result<u32>>,
        submit_evidence: this.txFromJSON<Result<void>>,
        approve_milestone: this.txFromJSON<Result<void>>,
        release_milestone: this.txFromJSON<Result<void>>,
        get_campaign_count: this.txFromJSON<u32>
  }
}