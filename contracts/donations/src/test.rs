#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient as TokenAdminClient},
    Address, BytesN, Env, String, Vec,
};

struct TestEnv {
    env: Env,
    client: ContractClient<'static>,
    token: TokenClient<'static>,
    token_admin: TokenAdminClient<'static>,
    org: Address,
    donor: Address,
    donor_two: Address,
}

fn setup() -> TestEnv {
    let env = Env::default();
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000_000);
    env.mock_all_auths();
    let org = Address::generate(&env);
    let donor = Address::generate(&env);
    let donor_two = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.initialize(&1_000, &org);
    let token_admin_address = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin_address);
    let token_address = token_contract.address();
    let token = TokenClient::new(&env, &token_address);
    let token_admin = TokenAdminClient::new(&env, &token_address);
    token_admin.mint(&org, &1_000_000);
    TestEnv {
        env,
        client,
        token,
        token_admin,
        org,
        donor,
        donor_two,
    }
}

fn create_campaign(test: &TestEnv, amounts: &[i128]) -> u32 {
    let mut milestones = Vec::new(&test.env);
    for (index, amount) in amounts.iter().enumerate() {
        milestones.push_back((
            String::from_str(&test.env, if index == 0 { "First" } else { "Next" }),
            *amount,
        ));
    }
    test.client.create_campaign(
        &test.org,
        &test.token.address,
        &String::from_str(&test.env, "ClearFund campaign"),
        &String::from_str(&test.env, "ipfs://campaign"),
        &milestones,
        &60,
        &(test.env.ledger().timestamp() + 3_600),
    )
}

fn mint(test: &TestEnv, donor: &Address, amount: i128) {
    test.token_admin.mint(donor, &amount);
}

fn submit_evidence(test: &TestEnv, campaign_id: u32, index: u32) {
    test.client.submit_evidence(
        &campaign_id,
        &index,
        &BytesN::from_array(&test.env, &[7; 32]),
        &String::from_str(&test.env, "ipfs://evidence"),
    );
}

fn advance(test: &TestEnv, seconds: u64) {
    test.env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += seconds);
}

#[test]
fn happy_path_completes_and_returns_bond() {
    let test = setup();
    let id = create_campaign(&test, &[100]);
    assert_eq!(test.token.balance(&test.org), 999_990);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &id, &100);
    submit_evidence(&test, id, 0);
    advance(&test, 60);
    test.client.release_milestone(&id, &0);
    let campaign = test.client.get_campaign(&id);
    assert_eq!(campaign.status, CampaignStatus::Completed);
    assert_eq!(campaign.total_released, 100);
    assert_eq!(test.token.balance(&test.org), 1_000_100);
    assert_eq!(campaign.bond_state, BondState::Returned);
}

#[test]
fn rejects_excess_and_organization_donations() {
    let test = setup();
    let id = create_campaign(&test, &[100]);
    mint(&test, &test.donor, 101);
    assert!(test.client.try_donate(&test.org, &id, &1).is_err());
    assert!(test.client.try_donate(&test.donor, &id, &101).is_err());
    assert_eq!(test.client.get_campaign(&id).held, 0);
}

#[test]
fn evidence_must_be_ordered_and_funded() {
    let test = setup();
    let id = create_campaign(&test, &[50, 50]);
    assert!(test
        .client
        .try_submit_evidence(
            &id,
            &0,
            &BytesN::from_array(&test.env, &[7; 32]),
            &String::from_str(&test.env, "ipfs://first"),
        )
        .is_err());
    mint(&test, &test.donor, 50);
    test.client.donate(&test.donor, &id, &50);
    assert!(test
        .client
        .try_submit_evidence(
            &id,
            &1,
            &BytesN::from_array(&test.env, &[7; 32]),
            &String::from_str(&test.env, "ipfs://second"),
        )
        .is_err());
    submit_evidence(&test, id, 0);
    advance(&test, 60);
    test.client.release_milestone(&id, &0);
    assert!(test
        .client
        .try_submit_evidence(
            &id,
            &1,
            &BytesN::from_array(&test.env, &[8; 32]),
            &String::from_str(&test.env, "ipfs://second"),
        )
        .is_err());
}

#[test]
fn donor_can_exit_during_window_and_release_uses_remaining_funds() {
    let test = setup();
    let id = create_campaign(&test, &[50, 50]);
    mint(&test, &test.donor, 50);
    mint(&test, &test.donor_two, 50);
    test.client.donate(&test.donor, &id, &50);
    test.client.donate(&test.donor_two, &id, &50);
    submit_evidence(&test, id, 0);
    assert_eq!(test.client.withdraw(&test.donor, &id), 50);
    advance(&test, 60);
    test.client.release_milestone(&id, &0);
    assert_eq!(test.token.balance(&test.org), 1_000_040);
    assert_eq!(test.client.get_campaign(&id).held, 0);
}

#[test]
fn withdraw_outside_window_and_release_before_window_end_are_rejected() {
    let test = setup();
    let id = create_campaign(&test, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &id, &100);
    assert!(test.client.try_withdraw(&test.donor, &id).is_err());
    submit_evidence(&test, id, 0);
    assert!(test.client.try_release_milestone(&id, &0).is_err());
}

#[test]
fn empty_campaign_rejects_release_and_bond_can_be_reclaimed_after_deadline() {
    let test = setup();
    let id = create_campaign(&test, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &id, &100);
    submit_evidence(&test, id, 0);
    test.client.withdraw(&test.donor, &id);
    advance(&test, 60);
    assert!(test.client.try_release_milestone(&id, &0).is_err());
    advance(&test, 3_541);
    test.client.reclaim_bond(&id);
    assert_eq!(
        test.client.get_campaign(&id).bond_state,
        BondState::Returned
    );
}

#[test]
fn abandoned_campaign_slashes_bond_proportionally_and_blocks_pending_release() {
    let test = setup();
    let id = create_campaign(&test, &[50, 50]);
    mint(&test, &test.donor, 50);
    mint(&test, &test.donor_two, 50);
    test.client.donate(&test.donor, &id, &50);
    test.client.donate(&test.donor_two, &id, &50);
    advance(&test, 3_601);
    assert_eq!(test.client.withdraw(&test.donor, &id), 55);
    assert_eq!(test.client.withdraw(&test.donor_two, &id), 55);
    assert_eq!(test.client.get_campaign(&id).bond_state, BondState::Slashed);

    let pending_id = create_campaign(&test, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &pending_id, &100);
    submit_evidence(&test, pending_id, 0);
    advance(&test, 3_601);
    assert!(test.client.try_withdraw(&test.donor, &pending_id).is_err());
}

#[test]
fn zero_held_resets_epoch_and_old_positions_are_zero() {
    let test = setup();
    let id = create_campaign(&test, &[50, 50]);
    mint(&test, &test.donor, 50);
    test.client.donate(&test.donor, &id, &50);
    submit_evidence(&test, id, 0);
    test.client.withdraw(&test.donor, &id);
    let campaign = test.client.get_campaign(&id);
    assert_eq!(campaign.held, 0);
    assert_eq!(campaign.total_shares, 0);
    assert_eq!(campaign.epoch, 1);
    assert_eq!(test.client.get_position(&id, &test.donor).value, 0);
    mint(&test, &test.donor_two, 50);
    test.client.donate(&test.donor_two, &id, &50);
    let new_position = test.client.get_position(&id, &test.donor_two);
    assert_eq!(new_position.value, 50);
    assert_eq!(test.client.get_position(&id, &test.donor).value, 0);
}

#[test]
fn cancellation_requires_no_donations() {
    let test = setup();
    let id = create_campaign(&test, &[100]);
    test.client.cancel_campaign(&id);
    assert_eq!(
        test.client.get_campaign(&id).status,
        CampaignStatus::Cancelled
    );
    let funded_id = create_campaign(&test, &[100]);
    mint(&test, &test.donor, 1);
    test.client.donate(&test.donor, &funded_id, &1);
    assert!(test.client.try_cancel_campaign(&funded_id).is_err());
}

#[test]
fn initialization_requires_auth_and_release_replay_is_rejected() {
    let test = setup();
    let id = create_campaign(&test, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &id, &100);
    submit_evidence(&test, id, 0);
    advance(&test, 60);
    test.client.release_milestone(&id, &0);
    assert!(test.client.try_release_milestone(&id, &0).is_err());

    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let org = Address::generate(&env);
    assert!(client.try_initialize(&1_000, &org).is_err());
    env.mock_all_auths();
    client.initialize(&1_000, &org);
}

#[test]
fn rounding_never_exceeds_deposits_and_bond_is_rounded_up() {
    let test = setup();
    let id = create_campaign(&test, &[7, 3]);
    assert_eq!(test.client.get_campaign(&id).bond_amount, 1);
    mint(&test, &test.donor, 3);
    mint(&test, &test.donor_two, 7);
    test.client.donate(&test.donor, &id, &3);
    test.client.donate(&test.donor_two, &id, &7);
    submit_evidence(&test, id, 0);
    assert!(test.client.withdraw(&test.donor, &id) <= 3);
    advance(&test, 60);
    test.client.release_milestone(&id, &0);
    let campaign = test.client.get_campaign(&id);
    assert!(campaign.total_withdrawn + campaign.total_released <= campaign.total_raised);
}
