import { Client as DonationsClient } from "@clearfun/sdk";
import { Address, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";

export interface TransactionServiceOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  rpcServer: rpc.Server;
  network: string;
}

export interface CreateCampaignTransaction {
  source: string;
  org: string;
  token: string;
  title: string;
  description_uri: string;
  milestones: Array<{ description: string; amount: string }>;
  verifiers: string[];
  threshold: number;
  deadline: string;
}

export interface DonateTransaction {
  source: string;
  donor: string;
  campaign_id: number;
  amount: string;
}

export interface SubmitEvidenceTransaction {
  campaign_id: number;
  milestone_index: number;
  evidence_hash: string;
  evidence_uri: string;
}

export interface ApproveMilestoneTransaction {
  source: string;
  verifier: string;
  campaign_id: number;
  milestone_index: number;
}

export interface ClaimRefundTransaction {
  source: string;
  donor: string;
  campaign_id: number;
}

type CampaignGetterValue = {
  org: string;
};

export interface SubmittedTransaction {
  hash: string;
  status: string;
  explorer_url: string;
}

export class TransactionService {
  constructor(private readonly options: TransactionServiceOptions) {}

  async createCampaign(input: CreateCampaignTransaction): Promise<string> {
    const client = this.client(input.source);
    const transaction = await client.create_campaign({
      org: input.org,
      token: input.token,
      title: input.title,
      description_uri: input.description_uri,
      milestones: input.milestones.map(
        (milestone) =>
          [milestone.description, BigInt(milestone.amount)] as const,
      ),
      verifiers: input.verifiers,
      threshold: input.threshold,
      deadline: BigInt(input.deadline),
    });
    return transaction.toXDR();
  }

  async donate(input: DonateTransaction): Promise<string> {
    const transaction = await this.client(input.source).donate({
      donor: input.donor,
      campaign_id: input.campaign_id,
      amount: BigInt(input.amount),
    });
    return transaction.toXDR();
  }

  async submitEvidence(input: SubmitEvidenceTransaction): Promise<string> {
    const campaign = await this.getCampaign(input.campaign_id);
    const transaction = await this.client(campaign.org).submit_evidence({
      campaign_id: input.campaign_id,
      milestone_index: input.milestone_index,
      evidence_hash: Buffer.from(input.evidence_hash, "hex"),
      evidence_uri: input.evidence_uri,
    });
    return transaction.toXDR();
  }

  async approveMilestone(input: ApproveMilestoneTransaction): Promise<string> {
    const transaction = await this.client(input.source).approve_milestone({
      verifier: input.verifier,
      campaign_id: input.campaign_id,
      milestone_index: input.milestone_index,
    });
    return transaction.toXDR();
  }

  async claimRefund(input: ClaimRefundTransaction): Promise<string> {
    const transaction = await this.client(input.source).claim_refund({
      donor: input.donor,
      campaign_id: input.campaign_id,
    });
    return transaction.toXDR();
  }

  async submitSignedXdr(envelopeXdr: string): Promise<SubmittedTransaction> {
    let transaction: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      transaction = TransactionBuilder.fromXDR(
        envelopeXdr,
        this.options.networkPassphrase,
      );
    } catch (error) {
      throw new TransactionInputError("Signed transaction XDR is invalid.", {
        cause: error,
      });
    }
    if (!(transaction instanceof Transaction)) {
      throw new TransactionInputError(
        "Fee-bump and legacy transaction envelopes are not accepted.",
      );
    }
    if (transaction.signatures.length === 0) {
      throw new TransactionInputError(
        "Transaction must be signed by the wallet before submission.",
      );
    }
    if (
      transaction.operations.length !== 1 ||
      transaction.operations[0]?.type !== "invokeHostFunction"
    ) {
      throw new TransactionInputError(
        "Only a single Soroban contract invocation can be submitted.",
      );
    }
    const operation = transaction.operations[0];
    if (
      operation?.type !== "invokeHostFunction" ||
      operation.func.type !== "hostFunctionTypeInvokeContract" ||
      Address.fromScAddress(
        operation.func.invokeContract.contractAddress,
      ).toString() !== this.options.contractId ||
      ![
        "create_campaign",
        "donate",
        "submit_evidence",
        "approve_milestone",
        "claim_refund",
      ].includes(operation.func.invokeContract.functionName.toString())
    ) {
      throw new TransactionInputError(
        "The transaction must invoke an allowed ClearFun contract method.",
      );
    }

    const response = await this.options.rpcServer.sendTransaction(transaction);
    if (response.status === "ERROR") {
      throw new TransactionInputError(
        "Soroban RPC rejected the transaction for submission.",
      );
    }

    const confirmation = await this.options.rpcServer.pollTransaction(
      response.hash,
      {
        attempts: 20,
        sleepStrategy: (attempt) => Math.min(1000 * attempt, 5000),
      },
    );
    if (confirmation.status !== "SUCCESS") {
      throw new TransactionPendingError(response.hash);
    }
    return {
      hash: response.hash,
      status: confirmation.status,
      explorer_url: `https://stellar.expert/explorer/${this.options.network}/tx/${response.hash}`,
    };
  }

  private client(source: string): DonationsClient {
    Address.fromString(source);
    return new DonationsClient({
      contractId: this.options.contractId,
      networkPassphrase: this.options.networkPassphrase,
      rpcUrl: this.options.rpcUrl,
      publicKey: source,
    });
  }

  private async getCampaign(campaignId: number): Promise<CampaignGetterValue> {
    const { result } = await this.options.rpcServer.queryContract<{
      value: CampaignGetterValue;
    }>(
      this.options.contractId,
      "get_campaign",
      { campaign_id: campaignId },
      this.options.networkPassphrase,
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("value" in result) ||
      typeof result.value !== "object" ||
      result.value === null ||
      !("org" in result.value) ||
      typeof result.value.org !== "string"
    ) {
      throw new Error(
        `Unable to load organization for campaign ${campaignId}.`,
      );
    }
    return result.value;
  }
}

export class TransactionInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransactionInputError";
  }
}

export class TransactionPendingError extends Error {
  constructor(readonly hash: string) {
    super(`Transaction ${hash} was submitted but is not yet confirmed.`);
    this.name = "TransactionPendingError";
  }
}
