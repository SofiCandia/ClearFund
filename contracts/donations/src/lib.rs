#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    Address, BytesN, Env, String, Vec,
};

const STORAGE_TTL_THRESHOLD: u32 = 100_000;
const STORAGE_TTL_BUMP: u32 = 518_400;

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
    InvalidThreshold = 7,
    InvalidDeadline = 8,
    DuplicateVerifier = 9,
    OrganizationCannotVerify = 10,
    CampaignNotActive = 11,
    CampaignExpired = 12,
    InvalidMilestoneOrder = 13,
    InvalidMilestoneStatus = 14,
    NotVerifier = 15,
    AlreadyApproved = 16,
    AlreadyRefunded = 17,
    NothingToRefund = 18,
    NoRefundDue = 19,
    ArithmeticOverflow = 20,
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
    pub approvals: Vec<Address>,
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
    pub verifiers: Vec<Address>,
    pub threshold: u32,
    pub total_raised: i128,
    pub total_released: i128,
    pub status: CampaignStatus,
    pub milestones: Vec<Milestone>,
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
    pub total_raised: i128,
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
}

#[contractevent(topics = ["milestone_approved"])]
pub struct MilestoneApproved {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub verifier: Address,
    pub approvals_count: u32,
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

#[contractevent(topics = ["refund_claimed"])]
pub struct RefundClaimed {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub donor: Address,
    pub amount: i128,
}

#[contractevent(topics = ["campaign_completed"])]
pub struct CampaignCompleted {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub org: Address,
    pub total_released: i128,
}

#[contractevent(topics = ["campaign_cancelled"])]
pub struct CampaignCancelled {
    #[topic]
    pub campaign_id: u32,
    #[topic]
    pub org: Address,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Campaign(u32),
    Donation(u32, Address),
    Refunded(u32, Address),
}

#[contractimpl]
impl Contract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        put_persistent(&env, &DataKey::Admin, &admin);
        Ok(())
    }

    pub fn create_campaign(
        env: Env,
        org: Address,
        token: Address,
        title: String,
        description_uri: String,
        milestones: Vec<(String, i128)>,
        verifiers: Vec<Address>,
        threshold: u32,
        deadline: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        org.require_auth();

        if title.is_empty() || description_uri.is_empty() || milestones.is_empty() {
            return Err(Error::InvalidCampaign);
        }
        if threshold == 0 || threshold > verifiers.len() {
            return Err(Error::InvalidThreshold);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }

        for i in 0..verifiers.len() {
            let verifier = verifiers.get(i).ok_or(Error::InvalidCampaign)?;
            if verifier == org {
                return Err(Error::OrganizationCannotVerify);
            }
            for j in 0..i {
                if verifiers.get(j).ok_or(Error::InvalidCampaign)? == verifier {
                    return Err(Error::DuplicateVerifier);
                }
            }
        }

        let mut milestone_records = Vec::new(&env);
        let mut goal = 0_i128;
        for i in 0..milestones.len() {
            let (description, amount) = milestones.get(i).ok_or(Error::InvalidCampaign)?;
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
                approvals: Vec::new(&env),
            });
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
            verifiers,
            threshold,
            total_raised: 0,
            total_released: 0,
            status: CampaignStatus::Active,
            milestones: milestone_records,
        };
        put_campaign(&env, &campaign);
        env.storage().instance().set(&symbol_short!("count"), &id);
        env.storage()
            .instance()
            .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
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

        let new_total = campaign
            .total_raised
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        let donation_key = DataKey::Donation(campaign_id, donor.clone());
        let previous_donation = get_persistent::<i128>(&env, &donation_key).unwrap_or(0);
        let new_donation = previous_donation
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        campaign.total_raised = new_total;
        put_campaign(&env, &campaign);
        put_persistent(&env, &donation_key, &new_donation);
        token::Client::new(&env, &campaign.token).transfer(
            &donor,
            &env.current_contract_address(),
            &amount,
        );
        Donated {
            campaign_id,
            donor,
            amount,
            total_raised: new_total,
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

        milestone.status = MilestoneStatus::EvidenceSubmitted;
        milestone.evidence_hash = evidence_hash.clone();
        milestone.evidence_uri = evidence_uri.clone();
        campaign.milestones.set(milestone_index, milestone);
        put_campaign(&env, &campaign);
        EvidenceSubmitted {
            campaign_id,
            milestone_index,
            org: campaign.org,
            evidence_hash,
            evidence_uri,
        }
        .publish(&env);
        Ok(())
    }

    pub fn approve_milestone(
        env: Env,
        verifier: Address,
        campaign_id: u32,
        milestone_index: u32,
    ) -> Result<(), Error> {
        verifier.require_auth();
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        if campaign.status != CampaignStatus::Active {
            return Err(Error::CampaignNotActive);
        }
        if !contains_address(&campaign.verifiers, &verifier) {
            return Err(Error::NotVerifier);
        }
        let mut milestone = campaign
            .milestones
            .get(milestone_index)
            .ok_or(Error::InvalidMilestone)?;
        if milestone.status != MilestoneStatus::EvidenceSubmitted {
            return Err(Error::InvalidMilestoneStatus);
        }
        if contains_address(&milestone.approvals, &verifier) {
            return Err(Error::AlreadyApproved);
        }

        milestone.approvals.push_back(verifier.clone());
        campaign.milestones.set(milestone_index, milestone);
        put_campaign(&env, &campaign);
        MilestoneApproved {
            campaign_id,
            milestone_index,
            verifier,
            approvals_count: campaign
                .milestones
                .get(milestone_index)
                .ok_or(Error::InvalidMilestone)?
                .approvals
                .len(),
        }
        .publish(&env);
        if campaign
            .milestones
            .get(milestone_index)
            .ok_or(Error::InvalidMilestone)?
            .approvals
            .len()
            >= campaign.threshold
        {
            release_if_funded(&env, &mut campaign, milestone_index)?;
        }
        Ok(())
    }

    pub fn release_milestone(
        env: Env,
        campaign_id: u32,
        milestone_index: u32,
    ) -> Result<(), Error> {
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        release_if_funded(&env, &mut campaign, milestone_index)
    }

    pub fn claim_refund(env: Env, donor: Address, campaign_id: u32) -> Result<i128, Error> {
        donor.require_auth();
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        if env.ledger().timestamp() < campaign.deadline {
            return Err(Error::InvalidDeadline);
        }
        if campaign.status == CampaignStatus::Completed
            || campaign.status == CampaignStatus::Cancelled
        {
            return Err(Error::CampaignNotActive);
        }
        let refunded_key = DataKey::Refunded(campaign_id, donor.clone());
        if get_persistent::<bool>(&env, &refunded_key).unwrap_or(false) {
            return Err(Error::AlreadyRefunded);
        }
        let donation = get_persistent::<i128>(&env, &DataKey::Donation(campaign_id, donor.clone()))
            .unwrap_or(0);
        if donation == 0 || campaign.total_raised == 0 {
            return Err(Error::NothingToRefund);
        }
        let unreleased = campaign
            .total_raised
            .checked_sub(campaign.total_released)
            .ok_or(Error::ArithmeticOverflow)?;
        let refund = donation
            .checked_mul(unreleased)
            .ok_or(Error::ArithmeticOverflow)?
            .checked_div(campaign.total_raised)
            .ok_or(Error::ArithmeticOverflow)?;
        if refund <= 0 {
            return Err(Error::NoRefundDue);
        }

        campaign.status = CampaignStatus::Expired;
        put_campaign(&env, &campaign);
        put_persistent(&env, &refunded_key, &true);
        token::Client::new(&env, &campaign.token).transfer(
            &env.current_contract_address(),
            &donor,
            &refund,
        );
        RefundClaimed {
            campaign_id,
            donor,
            amount: refund,
        }
        .publish(&env);
        Ok(refund)
    }

    pub fn cancel_campaign(env: Env, campaign_id: u32) -> Result<(), Error> {
        let mut campaign = get_campaign_internal(&env, campaign_id)?;
        campaign.org.require_auth();
        if campaign.status != CampaignStatus::Active || campaign.total_raised != 0 {
            return Err(Error::CampaignNotActive);
        }
        campaign.status = CampaignStatus::Cancelled;
        put_campaign(&env, &campaign);
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
        if env.storage().persistent().has(&DataKey::Admin) {
            env.storage().persistent().extend_ttl(
                &DataKey::Admin,
                STORAGE_TTL_THRESHOLD,
                STORAGE_TTL_BUMP,
            );
        }
        env.storage()
            .instance()
            .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
        env.storage()
            .instance()
            .get(&symbol_short!("count"))
            .unwrap_or(0)
    }

    pub fn get_donation(env: Env, campaign_id: u32, donor: Address) -> Result<i128, Error> {
        ensure_campaign_exists(&env, campaign_id)?;
        Ok(get_persistent(&env, &DataKey::Donation(campaign_id, donor)).unwrap_or(0))
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
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if env.storage().persistent().has(&DataKey::Admin) {
        env.storage().persistent().extend_ttl(
            &DataKey::Admin,
            STORAGE_TTL_THRESHOLD,
            STORAGE_TTL_BUMP,
        );
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

fn ensure_campaign_exists(env: &Env, campaign_id: u32) -> Result<(), Error> {
    ensure_initialized(env)?;
    let key = DataKey::Campaign(campaign_id);
    if env.storage().persistent().has(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
        Ok(())
    } else {
        Err(Error::CampaignNotFound)
    }
}

fn get_campaign_internal(env: &Env, campaign_id: u32) -> Result<Campaign, Error> {
    ensure_campaign_exists(env, campaign_id)?;
    get_persistent(env, &DataKey::Campaign(campaign_id)).ok_or(Error::CampaignNotFound)
}

fn get_persistent<T>(env: &Env, key: &DataKey) -> Option<T>
where
    T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>,
{
    let value = env.storage().persistent().get(key);
    if value.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
    }
    value
}

fn put_persistent<T>(env: &Env, key: &DataKey, value: &T)
where
    T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    env.storage().persistent().set(key, value);
    env.storage()
        .persistent()
        .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
}

fn put_campaign(env: &Env, campaign: &Campaign) {
    put_persistent(env, &DataKey::Campaign(campaign.id), campaign);
}

fn contains_address(addresses: &Vec<Address>, address: &Address) -> bool {
    for i in 0..addresses.len() {
        if addresses.get(i).as_ref() == Some(address) {
            return true;
        }
    }
    false
}

fn release_if_funded(
    env: &Env,
    campaign: &mut Campaign,
    milestone_index: u32,
) -> Result<(), Error> {
    if campaign.status != CampaignStatus::Active {
        return Err(Error::CampaignNotActive);
    }
    let mut milestone = campaign
        .milestones
        .get(milestone_index)
        .ok_or(Error::InvalidMilestone)?;
    if milestone.status != MilestoneStatus::EvidenceSubmitted
        || milestone.approvals.len() < campaign.threshold
    {
        return Err(Error::InvalidMilestoneStatus);
    }

    let unallocated = campaign
        .total_raised
        .checked_sub(campaign.total_released)
        .ok_or(Error::ArithmeticOverflow)?;
    if unallocated < milestone.amount
        || token::Client::new(env, &campaign.token).balance(&env.current_contract_address())
            < milestone.amount
    {
        return Ok(());
    }

    let total_released = campaign
        .total_released
        .checked_add(milestone.amount)
        .ok_or(Error::ArithmeticOverflow)?;
    milestone.status = MilestoneStatus::Released;
    campaign.milestones.set(milestone_index, milestone.clone());
    campaign.total_released = total_released;
    if total_released == campaign.goal {
        campaign.status = CampaignStatus::Completed;
    }
    put_campaign(env, campaign);
    token::Client::new(env, &campaign.token).transfer(
        &env.current_contract_address(),
        &campaign.org,
        &milestone.amount,
    );
    MilestoneReleased {
        campaign_id: campaign.id,
        milestone_index,
        org: campaign.org.clone(),
        amount: milestone.amount,
    }
    .publish(env);
    if campaign.status == CampaignStatus::Completed {
        CampaignCompleted {
            campaign_id: campaign.id,
            org: campaign.org.clone(),
            total_released: campaign.total_released,
        }
        .publish(env);
    }
    Ok(())
}

mod test;
