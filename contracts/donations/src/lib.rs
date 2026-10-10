#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    Address, BytesN, Env, String, Vec,
};

const STORAGE_TTL_THRESHOLD: u32 = 100_000;
const STORAGE_TTL_BUMP: u32 = 518_400;
const DAY_SECS: u64 = 86_400;

#[contract]
pub struct Contract;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    CampaignNotFound = 3,
    InvalidCampaign = 4,
    InvalidMilestone = 5,
    InvalidAmount = 6,
    InvalidDeadline = 7,
    CampaignNotActive = 8,
    CampaignExpired = 9,
    InvalidMilestoneOrder = 10,
    InvalidMilestoneStatus = 11,
    ArithmeticOverflow = 12,
    ExceedsGoal = 13,
    OrganizationCannotDonate = 14,
    NotFunded = 15,
    WindowNotOpen = 16,
    ReleasePending = 17,
    NothingToWithdraw = 18,
    BondUnavailable = 19,
    InvalidWindow = 20,
    ZeroShares = 21,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BondState {
    Held,
    Returned,
    Slashed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    Active,
    Completed,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    EvidenceSubmitted,
    Released,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub description: String,
    pub amount: i128,
    pub status: MilestoneStatus,
    pub evidence_hash: BytesN<32>,
    pub evidence_uri: String,
    pub window_end: u64,
    pub released_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub id: u32,
    pub org: Address,
    pub token: Address,
    pub title: String,
    pub description_uri: String,
    pub goal: i128,
    pub deadline: u64,
    pub window_secs: u64,
    pub bond_amount: i128,
    pub bond_state: BondState,
    pub total_raised: i128,
    pub total_released: i128,
    pub total_withdrawn: i128,
    pub held: i128,
    pub total_shares: i128,
    pub epoch: u32,
    pub status: CampaignStatus,
    pub milestones: Vec<Milestone>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub contributed: i128,
    pub shares: i128,
    pub epoch: u32,
    pub withdrawn: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionView {
    pub contributed: i128,
    pub shares: i128,
    pub value: i128,
    pub withdrawn: i128,
}

#[contractevent(topics = ["campaign_created"])]
pub struct CampaignCreated {
    #[topic]
    pub campaign_id: u32,
    pub org: Address,
    pub token: Address,
    pub goal: i128,
    pub deadline: u64,
}

#[contractevent(topics = ["donated"])]
pub struct Donated {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub donor: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent(topics = ["evidence_submitted"])]
pub struct EvidenceSubmitted {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub milestone_index: u32,
    pub org: Address,
    pub evidence_hash: BytesN<32>,
    pub evidence_uri: String,
    pub window_end: u64,
}

#[contractevent(topics = ["exited"])]
pub struct Exited {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub donor: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent(topics = ["milestone_released"])]
pub struct MilestoneReleased {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub milestone_index: u32,
    pub org: Address,
    pub amount: i128,
}

#[contractevent(topics = ["campaign_completed"])]
pub struct CampaignCompleted {
    #[topic]
    pub campaign_id: u32,
    pub total_released: i128,
}

#[contractevent(topics = ["bond_returned"])]
pub struct BondReturned {
    #[topic]
    pub campaign_id: u32,
    pub org: Address,
    pub amount: i128,
}

#[contractevent(topics = ["bond_slashed"])]
pub struct BondSlashed {
    #[topic]
    pub campaign_id: u32,
    pub amount: i128,
}

#[contractevent(topics = ["campaign_cancelled"])]
pub struct CampaignCancelled {
    #[topic]
    pub campaign_id: u32,
    pub org: Address,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Campaign(u32),
    Position(u32, Address),
}

#[contractimpl]
impl Contract {
    pub fn initialize(env: Env, bond_bps: u32, initializer: Address) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        initializer.require_auth();
        if bond_bps > 5_000 {
            return Err(Error::InvalidAmount);
        }
        put_persistent(&env, &DataKey::Config, &bond_bps);
        Ok(())
    }

    pub fn create_campaign(
        env: Env,
        org: Address,
        token: Address,
        title: String,
        description_uri: String,
        milestones: Vec<(String, i128)>,
        window_secs: u64,
        deadline: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        org.require_auth();
        if title.is_empty() || description_uri.is_empty() || milestones.is_empty() {
            return Err(Error::InvalidCampaign);
        }
        if !(60..=2_592_000).contains(&window_secs) {
            return Err(Error::InvalidWindow);
        }
        let now = env.ledger().timestamp();
        let max_deadline = now
            .checked_add(365 * DAY_SECS)
            .ok_or(Error::ArithmeticOverflow)?;
        if deadline <= now || deadline > max_deadline {
            return Err(Error::InvalidDeadline);
        }

        let mut milestone_records = Vec::new(&env);
        let mut goal = 0_i128;
        for i in 0..milestones.len() {
            let (description, amount) = milestones.get(i).ok_or(Error::InvalidMilestone)?;
            if description.is_empty() || amount <= 0 {
                return Err(Error::InvalidAmount);
            }
            goal = goal.checked_add(amount).ok_or(Error::ArithmeticOverflow)?;
            milestone_records.push_back(Milestone {
                description,
                amount,
                status: MilestoneStatus::Pending,
                evidence_hash: BytesN::from_array(&env, &[0; 32]),
                evidence_uri: String::from_str(&env, ""),
                window_end: 0,
                released_amount: 0,
            });
        }
        let bond_bps: u32 = get_persistent(&env, &DataKey::Config).ok_or(Error::NotInitialized)?;
        let bond_product = goal
            .checked_mul(i128::from(bond_bps))
            .ok_or(Error::ArithmeticOverflow)?;
        let mut bond_amount = bond_product
            .checked_add(9_999)
            .ok_or(Error::ArithmeticOverflow)?
            .checked_div(10_000)
            .ok_or(Error::ArithmeticOverflow)?;
        if bond_bps > 0 && bond_amount == 0 {
            bond_amount = 1;
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&symbol_short!("count"))
            .unwrap_or(0);
        let id = count.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        let campaign = Campaign {
            id,
            org: org.clone(),
            token: token.clone(),
            title,
            description_uri,
            goal,
            deadline,
            window_secs,
            bond_amount,
            bond_state: BondState::Held,
            total_raised: 0,
            total_released: 0,
            total_withdrawn: 0,
            held: 0,
            total_shares: 0,
            epoch: 0,
            status: CampaignStatus::Active,
            milestones: milestone_records,
        };
        put_campaign(&env, &campaign);
        env.storage().instance().set(&symbol_short!("count"), &id);
        env.storage()
            .instance()
            .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
        if bond_amount > 0 {
            token::Client::new(&env, &token).transfer(
                &org,
                &env.current_contract_address(),
                &bond_amount,
            );
        }
        CampaignCreated {
            campaign_id: id,
            org,
            token,
            goal,
            deadline,
        }
        .publish(&env);
        Ok(id)
    }

    pub fn donate(env: Env, donor: Address, campaign_id: u32, amount: i128) -> Result<(), Error> {
        donor.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Active {
            return Err(Error::CampaignNotActive);
        }
        if env.ledger().timestamp() >= campaign.deadline {
            return Err(Error::CampaignExpired);
        }
        if donor == campaign.org {
            return Err(Error::OrganizationCannotDonate);
        }
        let funded = campaign
            .held
            .checked_add(campaign.total_released)
            .and_then(|value| value.checked_add(amount))
            .ok_or(Error::ArithmeticOverflow)?;
        if funded > campaign.goal {
            return Err(Error::ExceedsGoal);
        }
        let shares = if campaign.total_shares == 0 {
            amount
        } else {
            amount
                .checked_mul(campaign.total_shares)
                .ok_or(Error::ArithmeticOverflow)?
                .checked_div(campaign.held)
                .ok_or(Error::ArithmeticOverflow)?
        };
        if shares <= 0 {
            return Err(Error::ZeroShares);
        }
        let mut position = get_position_internal(&env, campaign_id, &donor);
        if position.epoch != campaign.epoch {
            position = Position {
                contributed: 0,
                shares: 0,
                epoch: campaign.epoch,
                withdrawn: 0,
            };
        }
        position.contributed = position
            .contributed
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        position.shares = position
            .shares
            .checked_add(shares)
            .ok_or(Error::ArithmeticOverflow)?;
        campaign.held = campaign
            .held
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        campaign.total_shares = campaign
            .total_shares
            .checked_add(shares)
            .ok_or(Error::ArithmeticOverflow)?;
        campaign.total_raised = campaign
            .total_raised
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        put_campaign(&env, &campaign);
        put_position(&env, campaign_id, &donor, &position);
        token::Client::new(&env, &campaign.token).transfer(
            &donor,
            &env.current_contract_address(),
            &amount,
        );
        Donated {
            campaign_id,
            donor,
            amount,
            shares,
        }
        .publish(&env);
        Ok(())
    }

    pub fn submit_evidence(
        env: Env,
        campaign_id: u32,
        milestone_index: u32,
        evidence_hash: BytesN<32>,
        evidence_uri: String,
    ) -> Result<(), Error> {
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        campaign.org.require_auth();
        if campaign.status != CampaignStatus::Active {
            return Err(Error::CampaignNotActive);
        }
        if evidence_uri.is_empty() {
            return Err(Error::InvalidCampaign);
        }
        let mut milestone = campaign
            .milestones
            .get(milestone_index)
            .ok_or(Error::InvalidMilestone)?;
        if milestone.status != MilestoneStatus::Pending {
            return Err(Error::InvalidMilestoneStatus);
        }
        for i in 0..milestone_index {
            if campaign
                .milestones
                .get(i)
                .ok_or(Error::InvalidMilestone)?
                .status
                != MilestoneStatus::Released
            {
                return Err(Error::InvalidMilestoneOrder);
            }
        }
        if campaign.held < milestone.amount {
            return Err(Error::NotFunded);
        }
        let window_end = env
            .ledger()
            .timestamp()
            .checked_add(campaign.window_secs)
            .ok_or(Error::ArithmeticOverflow)?;
        if window_end > campaign.deadline {
            return Err(Error::InvalidDeadline);
        }
        milestone.status = MilestoneStatus::EvidenceSubmitted;
        milestone.evidence_hash = evidence_hash.clone();
        milestone.evidence_uri = evidence_uri.clone();
        milestone.window_end = window_end;
        campaign.milestones.set(milestone_index, milestone);
        put_campaign(&env, &campaign);
        EvidenceSubmitted {
            campaign_id,
            milestone_index,
            org: campaign.org,
            evidence_hash,
            evidence_uri,
            window_end,
        }
        .publish(&env);
        Ok(())
    }

    pub fn withdraw(env: Env, donor: Address, campaign_id: u32) -> Result<i128, Error> {
        donor.require_auth();
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        let now = env.ledger().timestamp();
        let mut open_window = false;
        let mut expired_pending_release = false;
        for i in 0..campaign.milestones.len() {
            let milestone = campaign.milestones.get(i).ok_or(Error::InvalidMilestone)?;
            if milestone.status == MilestoneStatus::EvidenceSubmitted {
                if now < milestone.window_end {
                    open_window = true;
                } else {
                    expired_pending_release = true;
                }
            }
        }
        if !open_window {
            if now <= campaign.deadline || campaign.status == CampaignStatus::Completed {
                return Err(Error::WindowNotOpen);
            }
            if expired_pending_release {
                return Err(Error::ReleasePending);
            }
            if campaign.bond_state == BondState::Held && campaign.total_shares > 0 {
                campaign.held = campaign
                    .held
                    .checked_add(campaign.bond_amount)
                    .ok_or(Error::ArithmeticOverflow)?;
                campaign.bond_state = BondState::Slashed;
                campaign.status = CampaignStatus::Expired;
                BondSlashed {
                    campaign_id,
                    amount: campaign.bond_amount,
                }
                .publish(&env);
            }
        }

        let mut position = get_position_internal(&env, campaign_id, &donor);
        if position.epoch != campaign.epoch || position.shares <= 0 || campaign.total_shares <= 0 {
            return Err(Error::NothingToWithdraw);
        }
        let shares = position.shares;
        let amount = shares
            .checked_mul(campaign.held)
            .ok_or(Error::ArithmeticOverflow)?
            .checked_div(campaign.total_shares)
            .ok_or(Error::ArithmeticOverflow)?;
        if amount <= 0 {
            return Err(Error::NothingToWithdraw);
        }
        campaign.held = campaign
            .held
            .checked_sub(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        campaign.total_shares = campaign
            .total_shares
            .checked_sub(shares)
            .ok_or(Error::ArithmeticOverflow)?;
        campaign.total_withdrawn = campaign
            .total_withdrawn
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        position.shares = 0;
        position.withdrawn = position
            .withdrawn
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        if campaign.held == 0 {
            campaign.total_shares = 0;
            campaign.epoch = campaign
                .epoch
                .checked_add(1)
                .ok_or(Error::ArithmeticOverflow)?;
        }
        put_campaign(&env, &campaign);
        put_position(&env, campaign_id, &donor, &position);
        token::Client::new(&env, &campaign.token).transfer(
            &env.current_contract_address(),
            &donor,
            &amount,
        );
        Exited {
            campaign_id,
            donor,
            amount,
            shares,
        }
        .publish(&env);
        Ok(amount)
    }

    pub fn release_milestone(
        env: Env,
        campaign_id: u32,
        milestone_index: u32,
    ) -> Result<(), Error> {
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        let mut milestone = campaign
            .milestones
            .get(milestone_index)
            .ok_or(Error::InvalidMilestone)?;
        if milestone.status != MilestoneStatus::EvidenceSubmitted {
            return Err(Error::InvalidMilestoneStatus);
        }
        if env.ledger().timestamp() < milestone.window_end {
            return Err(Error::WindowNotOpen);
        }
        if campaign.held <= 0 {
            return Err(Error::NotFunded);
        }
        let amount = if milestone.amount < campaign.held {
            milestone.amount
        } else {
            campaign.held
        };
        campaign.held = campaign
            .held
            .checked_sub(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        campaign.total_released = campaign
            .total_released
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        milestone.status = MilestoneStatus::Released;
        milestone.released_amount = amount;
        campaign.milestones.set(milestone_index, milestone);
        let mut all_released = true;
        for i in 0..campaign.milestones.len() {
            if campaign
                .milestones
                .get(i)
                .ok_or(Error::InvalidMilestone)?
                .status
                != MilestoneStatus::Released
            {
                all_released = false;
                break;
            }
        }
        if campaign.held == 0 {
            campaign.total_shares = 0;
            campaign.epoch = campaign
                .epoch
                .checked_add(1)
                .ok_or(Error::ArithmeticOverflow)?;
        }
        if all_released {
            campaign.status = CampaignStatus::Completed;
            if campaign.bond_state == BondState::Held {
                campaign.bond_state = BondState::Returned;
            }
        }
        put_campaign(&env, &campaign);
        token::Client::new(&env, &campaign.token).transfer(
            &env.current_contract_address(),
            &campaign.org,
            &amount,
        );
        MilestoneReleased {
            campaign_id,
            milestone_index,
            org: campaign.org.clone(),
            amount,
        }
        .publish(&env);
        if all_released {
            CampaignCompleted {
                campaign_id,
                total_released: campaign.total_released,
            }
            .publish(&env);
            if campaign.bond_amount > 0 {
                token::Client::new(&env, &campaign.token).transfer(
                    &env.current_contract_address(),
                    &campaign.org,
                    &campaign.bond_amount,
                );
            }
            BondReturned {
                campaign_id,
                org: campaign.org,
                amount: campaign.bond_amount,
            }
            .publish(&env);
        }
        Ok(())
    }

    pub fn reclaim_bond(env: Env, campaign_id: u32) -> Result<(), Error> {
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        campaign.org.require_auth();
        if env.ledger().timestamp() <= campaign.deadline
            || campaign.status == CampaignStatus::Completed
            || campaign.total_shares != 0
            || campaign.bond_state != BondState::Held
        {
            return Err(Error::BondUnavailable);
        }
        campaign.bond_state = BondState::Returned;
        put_campaign(&env, &campaign);
        if campaign.bond_amount > 0 {
            token::Client::new(&env, &campaign.token).transfer(
                &env.current_contract_address(),
                &campaign.org,
                &campaign.bond_amount,
            );
        }
        BondReturned {
            campaign_id,
            org: campaign.org,
            amount: campaign.bond_amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_campaign(env: Env, campaign_id: u32) -> Result<(), Error> {
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        campaign.org.require_auth();
        if campaign.status != CampaignStatus::Active || campaign.total_raised != 0 {
            return Err(Error::CampaignNotActive);
        }
        campaign.status = CampaignStatus::Cancelled;
        if campaign.bond_state == BondState::Held {
            campaign.bond_state = BondState::Returned;
        }
        put_campaign(&env, &campaign);
        if campaign.bond_amount > 0 {
            token::Client::new(&env, &campaign.token).transfer(
                &env.current_contract_address(),
                &campaign.org,
                &campaign.bond_amount,
            );
        }
        BondReturned {
            campaign_id,
            org: campaign.org.clone(),
            amount: campaign.bond_amount,
        }
        .publish(&env);
        CampaignCancelled {
            campaign_id,
            org: campaign.org,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_campaign(env: Env, campaign_id: u32) -> Result<Campaign, Error> {
        get_campaign_internal(&env, campaign_id)
    }

    pub fn get_campaign_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
        env.storage()
            .instance()
            .get(&symbol_short!("count"))
            .unwrap_or(0)
    }

    pub fn get_milestone(
        env: Env,
        campaign_id: u32,
        milestone_index: u32,
    ) -> Result<Milestone, Error> {
        get_campaign_internal(&env, campaign_id)?
            .milestones
            .get(milestone_index)
            .ok_or(Error::InvalidMilestone)
    }

    pub fn get_position(env: Env, campaign_id: u32, donor: Address) -> Result<PositionView, Error> {
        let campaign = get_campaign_internal(&env, campaign_id)?;
        let position = get_position_internal(&env, campaign_id, &donor);
        if position.epoch != campaign.epoch {
            return Ok(PositionView {
                contributed: position.contributed,
                shares: 0,
                value: 0,
                withdrawn: position.withdrawn,
            });
        }
        let value = if campaign.total_shares == 0 {
            0
        } else {
            position
                .shares
                .checked_mul(campaign.held)
                .ok_or(Error::ArithmeticOverflow)?
                .checked_div(campaign.total_shares)
                .ok_or(Error::ArithmeticOverflow)?
        };
        Ok(PositionView {
            contributed: position.contributed,
            shares: position.shares,
            value,
            withdrawn: position.withdrawn,
        })
    }

    pub fn get_config(env: Env) -> Result<u32, Error> {
        get_persistent(&env, &DataKey::Config).ok_or(Error::NotInitialized)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    get_persistent::<u32>(env, &DataKey::Config)
        .map(|_| ())
        .ok_or(Error::NotInitialized)
}

fn get_campaign_internal(env: &Env, campaign_id: u32) -> Result<Campaign, Error> {
    get_persistent(env, &DataKey::Campaign(campaign_id)).ok_or(Error::CampaignNotFound)
}

fn get_position_internal(env: &Env, campaign_id: u32, donor: &Address) -> Position {
    get_persistent(env, &DataKey::Position(campaign_id, donor.clone())).unwrap_or(Position {
        contributed: 0,
        shares: 0,
        epoch: 0,
        withdrawn: 0,
    })
}

fn put_campaign(env: &Env, campaign: &Campaign) {
    put_persistent(env, &DataKey::Campaign(campaign.id), campaign);
}

fn put_position(env: &Env, campaign_id: u32, donor: &Address, position: &Position) {
    put_persistent(
        env,
        &DataKey::Position(campaign_id, donor.clone()),
        position,
    );
}

fn put_persistent<T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
    value: &T,
) {
    env.storage().persistent().set(key, value);
    env.storage()
        .persistent()
        .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
}

fn get_persistent<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
) -> Option<T> {
    if !env.storage().persistent().has(key) {
        return None;
    }
    env.storage()
        .persistent()
        .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
    env.storage().persistent().get(key)
}

#[cfg(test)]
mod test;
