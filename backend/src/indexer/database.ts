import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";

export interface CampaignSnapshot {
  id: number;
  org: string;
  token: string;
  title: string;
  description_uri: string;
  goal: string;
  deadline: number;
  threshold: number;
  total_raised: string;
  total_released: string;
  status: string;
  verifiers: string[];
  milestones: Array<{
    description: string;
    amount: string;
    status: string;
    evidence_hash: string;
    evidence_uri: string;
    approvals: string[];
  }>;
}

export interface StoredEvent {
  id: string;
  txHash: string;
  ledger: number;
  timestamp: string;
  type: string;
  payload: string;
  explorerUrl: string;
}

export type EventProjection =
  | { type: "campaign_created"; campaignId: number }
  | {
      type: "donated";
      campaignId: number;
      donor: string;
      amount: string;
      totalRaised: string;
    }
  | {
      type: "evidence_submitted";
      campaignId: number;
      milestoneIndex: number;
      evidenceHash: string;
      evidenceUri: string;
    }
  | {
      type: "milestone_approved";
      campaignId: number;
      milestoneIndex: number;
      verifier: string;
    }
  | {
      type: "milestone_released";
      campaignId: number;
      milestoneIndex: number;
      amount: string;
    }
  | {
      type: "refund_claimed";
      campaignId: number;
      donor: string;
      amount: string;
    }
  | { type: "campaign_completed"; campaignId: number; totalReleased: string }
  | { type: "campaign_cancelled"; campaignId: number }
  | { type: "unknown" };

export class IndexerDatabase {
  readonly connection: Database.Database;

  constructor(databaseUrl: string) {
    if (databaseUrl !== ":memory:") {
      const filename = isAbsolute(databaseUrl)
        ? databaseUrl
        : resolve(process.cwd(), databaseUrl);
      mkdirSync(dirname(filename), { recursive: true });
      this.connection = new Database(filename);
    } else {
      this.connection = new Database(":memory:");
    }

    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY,
        org TEXT NOT NULL,
        token TEXT NOT NULL,
        title TEXT NOT NULL,
        description_uri TEXT NOT NULL,
        goal TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        threshold INTEGER NOT NULL,
        verifiers_json TEXT NOT NULL,
        total_raised TEXT NOT NULL,
        total_released TEXT NOT NULL,
        total_refunded TEXT NOT NULL DEFAULT '0',
        status TEXT NOT NULL,
        updated_ledger INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS milestones (
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        milestone_index INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,
        evidence_uri TEXT NOT NULL,
        approvals_json TEXT NOT NULL,
        updated_ledger INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, milestone_index)
      );

      CREATE TABLE IF NOT EXISTS donations (
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        donor TEXT NOT NULL,
        amount TEXT NOT NULL,
        refunded_amount TEXT NOT NULL DEFAULT '0',
        updated_ledger INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, donor)
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        explorer_url TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_ledger_idx ON events(ledger);
      CREATE INDEX IF NOT EXISTS donations_donor_idx ON donations(donor);

      CREATE TABLE IF NOT EXISTS indexer_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_ledger INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO indexer_state (id, last_ledger) VALUES (1, 0);
    `);
  }

  getLastLedger(): number {
    const row = this.connection
      .prepare("SELECT last_ledger FROM indexer_state WHERE id = 1")
      .get() as { last_ledger: number };
    return row.last_ledger;
  }

  setLastLedger(ledger: number): void {
    this.connection
      .prepare("UPDATE indexer_state SET last_ledger = ? WHERE id = 1")
      .run(ledger);
  }

  syncCampaignSnapshot(campaign: CampaignSnapshot, ledger: number): void {
    this.connection.transaction(() => this.upsertCampaign(campaign, ledger))();
  }

  hasCampaign(campaignId: number): boolean {
    return Boolean(
      this.connection
        .prepare("SELECT 1 FROM campaigns WHERE id = ?")
        .get(campaignId),
    );
  }

  recordEvent(
    event: StoredEvent,
    projection: EventProjection,
    campaign: CampaignSnapshot | undefined,
  ): boolean {
    return this.connection.transaction(() => {
      const inserted = this.connection
        .prepare(
          `INSERT OR IGNORE INTO events
            (event_id, tx_hash, ledger, timestamp, type, payload_json, explorer_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.txHash,
          event.ledger,
          event.timestamp,
          event.type,
          event.payload,
          event.explorerUrl,
        );

      if (inserted.changes === 0) {
        return false;
      }

      if (campaign) {
        this.upsertCampaign(campaign, event.ledger);
      }

      this.applyProjection(projection, event.ledger);
      return true;
    })();
  }

  close(): void {
    this.connection.close();
  }

  private upsertCampaign(campaign: CampaignSnapshot, ledger: number): void {
    this.connection
      .prepare(
        `INSERT INTO campaigns (
           id, org, token, title, description_uri, goal, deadline, threshold,
           verifiers_json, total_raised, total_released, status, updated_ledger
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           org = excluded.org,
           token = excluded.token,
           title = excluded.title,
           description_uri = excluded.description_uri,
           goal = excluded.goal,
           deadline = excluded.deadline,
           threshold = excluded.threshold,
           verifiers_json = excluded.verifiers_json,
           total_raised = excluded.total_raised,
           total_released = excluded.total_released,
           status = excluded.status,
           updated_ledger = MAX(campaigns.updated_ledger, excluded.updated_ledger)`,
      )
      .run(
        campaign.id,
        campaign.org,
        campaign.token,
        campaign.title,
        campaign.description_uri,
        campaign.goal,
        campaign.deadline,
        campaign.threshold,
        JSON.stringify(campaign.verifiers),
        campaign.total_raised,
        campaign.total_released,
        campaign.status,
        ledger,
      );

    const milestoneStatement = this.connection.prepare(
      `INSERT INTO milestones (
         campaign_id, milestone_index, description, amount, status,
         evidence_hash, evidence_uri, approvals_json, updated_ledger
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, milestone_index) DO UPDATE SET
         description = excluded.description,
         amount = excluded.amount,
         status = excluded.status,
         evidence_hash = excluded.evidence_hash,
         evidence_uri = excluded.evidence_uri,
         approvals_json = excluded.approvals_json,
         updated_ledger = MAX(milestones.updated_ledger, excluded.updated_ledger)`,
    );

    campaign.milestones.forEach((milestone, index) => {
      milestoneStatement.run(
        campaign.id,
        index,
        milestone.description,
        milestone.amount,
        milestone.status,
        milestone.evidence_hash,
        milestone.evidence_uri,
        JSON.stringify(milestone.approvals),
        ledger,
      );
    });
  }

  private applyProjection(projection: EventProjection, ledger: number): void {
    switch (projection.type) {
      case "campaign_created":
        return;
      case "donated": {
        const previous = this.connection
          .prepare(
            "SELECT amount FROM donations WHERE campaign_id = ? AND donor = ?",
          )
          .get(projection.campaignId, projection.donor) as
          { amount: string } | undefined;
        const amount = (
          BigInt(previous?.amount ?? "0") + BigInt(projection.amount)
        ).toString();
        this.connection
          .prepare(
            `INSERT INTO donations (campaign_id, donor, amount, updated_ledger)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(campaign_id, donor) DO UPDATE SET
               amount = excluded.amount,
               updated_ledger = MAX(donations.updated_ledger, excluded.updated_ledger)`,
          )
          .run(projection.campaignId, projection.donor, amount, ledger);
        this.connection
          .prepare(
            "UPDATE campaigns SET total_raised = ?, updated_ledger = MAX(updated_ledger, ?) WHERE id = ?",
          )
          .run(projection.totalRaised, ledger, projection.campaignId);
        return;
      }
      case "evidence_submitted":
        this.connection
          .prepare(
            `UPDATE milestones
             SET status = 'EvidenceSubmitted', evidence_hash = ?, evidence_uri = ?,
                 updated_ledger = MAX(updated_ledger, ?)
             WHERE campaign_id = ? AND milestone_index = ?`,
          )
          .run(
            projection.evidenceHash,
            projection.evidenceUri,
            ledger,
            projection.campaignId,
            projection.milestoneIndex,
          );
        return;
      case "milestone_approved": {
        const row = this.connection
          .prepare(
            "SELECT approvals_json FROM milestones WHERE campaign_id = ? AND milestone_index = ?",
          )
          .get(projection.campaignId, projection.milestoneIndex) as
          { approvals_json: string } | undefined;
        if (!row) return;
        const approvals = JSON.parse(row.approvals_json) as string[];
        if (!approvals.includes(projection.verifier)) {
          approvals.push(projection.verifier);
        }
        this.connection
          .prepare(
            `UPDATE milestones
             SET approvals_json = ?, updated_ledger = MAX(updated_ledger, ?)
             WHERE campaign_id = ? AND milestone_index = ?`,
          )
          .run(
            JSON.stringify(approvals),
            ledger,
            projection.campaignId,
            projection.milestoneIndex,
          );
        return;
      }
      case "milestone_released":
        this.connection
          .prepare(
            `UPDATE milestones
             SET status = 'Released', updated_ledger = MAX(updated_ledger, ?)
             WHERE campaign_id = ? AND milestone_index = ?`,
          )
          .run(ledger, projection.campaignId, projection.milestoneIndex);
        this.addCampaignAmount(
          projection.campaignId,
          "total_released",
          projection.amount,
          ledger,
        );
        return;
      case "refund_claimed":
        this.addCampaignAmount(
          projection.campaignId,
          "total_refunded",
          projection.amount,
          ledger,
        );
        this.addDonationRefund(
          projection.campaignId,
          projection.donor,
          projection.amount,
          ledger,
        );
        return;
      case "campaign_completed":
        this.connection
          .prepare(
            `UPDATE campaigns
             SET status = 'Completed', total_released = ?,
                 updated_ledger = MAX(updated_ledger, ?)
             WHERE id = ?`,
          )
          .run(projection.totalReleased, ledger, projection.campaignId);
        return;
      case "campaign_cancelled":
        this.connection
          .prepare(
            "UPDATE campaigns SET status = 'Cancelled', updated_ledger = MAX(updated_ledger, ?) WHERE id = ?",
          )
          .run(ledger, projection.campaignId);
        return;
      case "unknown":
        return;
    }
  }

  private addCampaignAmount(
    campaignId: number,
    column: "total_released" | "total_refunded",
    amount: string,
    ledger: number,
  ): void {
    const row = this.connection
      .prepare(`SELECT ${column} AS amount FROM campaigns WHERE id = ?`)
      .get(campaignId) as { amount: string } | undefined;
    if (!row) return;
    const updated = (BigInt(row.amount) + BigInt(amount)).toString();
    this.connection
      .prepare(
        `UPDATE campaigns SET ${column} = ?, updated_ledger = MAX(updated_ledger, ?) WHERE id = ?`,
      )
      .run(updated, ledger, campaignId);
  }

  private addDonationRefund(
    campaignId: number,
    donor: string,
    amount: string,
    ledger: number,
  ): void {
    const row = this.connection
      .prepare(
        "SELECT refunded_amount FROM donations WHERE campaign_id = ? AND donor = ?",
      )
      .get(campaignId, donor) as { refunded_amount: string } | undefined;
    if (!row) return;
    const updated = (BigInt(row.refunded_amount) + BigInt(amount)).toString();
    this.connection
      .prepare(
        `UPDATE donations SET refunded_amount = ?, updated_ledger = MAX(updated_ledger, ?)
         WHERE campaign_id = ? AND donor = ?`,
      )
      .run(updated, ledger, campaignId, donor);
  }
}
