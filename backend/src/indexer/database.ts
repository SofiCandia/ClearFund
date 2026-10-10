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
  window_secs: number;
  bond_amount: string;
  bond_state: string;
  total_raised: string;
  total_released: string;
  total_withdrawn: string;
  held: string;
  total_shares: string;
  epoch: number;
  status: string;
  milestones: Array<{
    description: string;
    amount: string;
    status: string;
    evidence_hash: string;
    evidence_uri: string;
    window_end: number;
    released_amount: string;
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
      shares: string;
    }
  | {
      type: "evidence_submitted";
      campaignId: number;
      milestoneIndex: number;
      evidenceHash: string;
      evidenceUri: string;
      windowEnd: number;
    }
  | {
      type: "exited";
      campaignId: number;
      donor: string;
      amount: string;
      shares: string;
    }
  | {
      type: "milestone_released";
      campaignId: number;
      milestoneIndex: number;
      amount: string;
    }
  | { type: "campaign_completed"; campaignId: number; totalReleased: string }
  | { type: "bond_returned"; campaignId: number }
  | { type: "bond_slashed"; campaignId: number }
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
        window_secs INTEGER NOT NULL,
        bond_amount TEXT NOT NULL,
        bond_state TEXT NOT NULL,
        total_raised TEXT NOT NULL,
        total_released TEXT NOT NULL,
        total_withdrawn TEXT NOT NULL,
        held TEXT NOT NULL,
        total_shares TEXT NOT NULL,
        epoch INTEGER NOT NULL,
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
        window_end INTEGER NOT NULL,
        released_amount TEXT NOT NULL,
        updated_ledger INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, milestone_index)
      );

      CREATE TABLE IF NOT EXISTS donations (
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        donor TEXT NOT NULL,
        amount TEXT NOT NULL,
        shares TEXT NOT NULL,
        withdrawn TEXT NOT NULL DEFAULT '0',
        position_epoch INTEGER NOT NULL DEFAULT 0,
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
      CREATE INDEX IF NOT EXISTS campaigns_token_idx ON campaigns(token);

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
      if (inserted.changes === 0) return false;
      if (campaign) this.upsertCampaign(campaign, event.ledger);
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
           id, org, token, title, description_uri, goal, deadline, window_secs,
           bond_amount, bond_state, total_raised, total_released, total_withdrawn,
           held, total_shares, epoch, status, updated_ledger
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           org = excluded.org, token = excluded.token, title = excluded.title,
           description_uri = excluded.description_uri, goal = excluded.goal,
           deadline = excluded.deadline, window_secs = excluded.window_secs,
           bond_amount = excluded.bond_amount, bond_state = excluded.bond_state,
           total_raised = excluded.total_raised, total_released = excluded.total_released,
           total_withdrawn = excluded.total_withdrawn, held = excluded.held,
           total_shares = excluded.total_shares, epoch = excluded.epoch,
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
        campaign.window_secs,
        campaign.bond_amount,
        campaign.bond_state,
        campaign.total_raised,
        campaign.total_released,
        campaign.total_withdrawn,
        campaign.held,
        campaign.total_shares,
        campaign.epoch,
        campaign.status,
        ledger,
      );

    const statement = this.connection.prepare(
      `INSERT INTO milestones (
         campaign_id, milestone_index, description, amount, status,
         evidence_hash, evidence_uri, window_end, released_amount, updated_ledger
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, milestone_index) DO UPDATE SET
         description = excluded.description, amount = excluded.amount,
         status = excluded.status, evidence_hash = excluded.evidence_hash,
         evidence_uri = excluded.evidence_uri, window_end = excluded.window_end,
         released_amount = excluded.released_amount,
         updated_ledger = MAX(milestones.updated_ledger, excluded.updated_ledger)`,
    );
    campaign.milestones.forEach((milestone, index) => {
      statement.run(
        campaign.id,
        index,
        milestone.description,
        milestone.amount,
        milestone.status,
        milestone.evidence_hash,
        milestone.evidence_uri,
        milestone.window_end,
        milestone.released_amount,
        ledger,
      );
    });
  }

  private applyProjection(projection: EventProjection, ledger: number): void {
    switch (projection.type) {
      case "campaign_created":
      case "campaign_completed":
      case "bond_returned":
      case "bond_slashed":
      case "campaign_cancelled":
      case "unknown":
        return;
      case "donated": {
        const previous = this.connection
          .prepare(
            "SELECT amount, shares, position_epoch FROM donations WHERE campaign_id = ? AND donor = ?",
          )
          .get(projection.campaignId, projection.donor) as
          | { amount: string; shares: string; position_epoch: number }
          | undefined;
        this.connection
          .prepare(
            `INSERT INTO donations
              (campaign_id, donor, amount, shares, withdrawn, position_epoch, updated_ledger)
             VALUES (?, ?, ?, ?, '0', 0, ?)
             ON CONFLICT(campaign_id, donor) DO UPDATE SET
               amount = ?, shares = ?, updated_ledger = MAX(donations.updated_ledger, ?)`,
          )
          .run(
            projection.campaignId,
            projection.donor,
            (
              BigInt(previous?.amount ?? "0") + BigInt(projection.amount)
            ).toString(),
            (
              BigInt(previous?.shares ?? "0") + BigInt(projection.shares)
            ).toString(),
            ledger,
            (
              BigInt(previous?.amount ?? "0") + BigInt(projection.amount)
            ).toString(),
            (
              BigInt(previous?.shares ?? "0") + BigInt(projection.shares)
            ).toString(),
            ledger,
          );
        return;
      }
      case "evidence_submitted":
        this.connection
          .prepare(
            `UPDATE milestones SET status = 'EvidenceSubmitted', evidence_hash = ?,
             evidence_uri = ?, window_end = ?, updated_ledger = MAX(updated_ledger, ?)
             WHERE campaign_id = ? AND milestone_index = ?`,
          )
          .run(
            projection.evidenceHash,
            projection.evidenceUri,
            projection.windowEnd,
            ledger,
            projection.campaignId,
            projection.milestoneIndex,
          );
        return;
      case "exited": {
        const row = this.connection
          .prepare(
            "SELECT shares, withdrawn FROM donations WHERE campaign_id = ? AND donor = ?",
          )
          .get(projection.campaignId, projection.donor) as
          { shares: string; withdrawn: string } | undefined;
        if (!row) return;
        this.connection
          .prepare(
            `UPDATE donations SET shares = ?, withdrawn = ?, updated_ledger = MAX(updated_ledger, ?)
             WHERE campaign_id = ? AND donor = ?`,
          )
          .run(
            (BigInt(row.shares) - BigInt(projection.shares)).toString(),
            (BigInt(row.withdrawn) + BigInt(projection.amount)).toString(),
            ledger,
            projection.campaignId,
            projection.donor,
          );
        return;
      }
      case "milestone_released":
        this.connection
          .prepare(
            `UPDATE milestones SET status = 'Released', released_amount = ?,
             updated_ledger = MAX(updated_ledger, ?)
             WHERE campaign_id = ? AND milestone_index = ?`,
          )
          .run(
            projection.amount,
            ledger,
            projection.campaignId,
            projection.milestoneIndex,
          );
        return;
    }
  }
}
