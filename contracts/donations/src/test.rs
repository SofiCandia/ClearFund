#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient as TokenAdminClient},
    vec, Address, BytesN, Env, String, Vec,
};

struct TestEnv {
    env: Env,
    client: ContractClient<'static>,
    token: TokenClient<'static>,
    token_admin: TokenAdminClient<'static>,
    org: Address,
    donor: Address,
    donor_two: Address,
    verifiers: Vec<Address>,
}

fn setup() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();
    let org = Address::generate(&env);
    let donor = Address::generate(&env);
    let donor_two = Address::generate(&env);
    let verifier_one = Address::generate(&env);
    let verifier_two = Address::generate(&env);
    let verifier_three = Address::generate(&env);
    let verifiers = vec![&env, verifier_one, verifier_two, verifier_three];
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    client.initialize(&org);

    let token_admin_address = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin_address);
    let token_address = token_contract.address();
    let token = TokenClient::new(&env, &token_address);
    let token_admin = TokenAdminClient::new(&env, &token_address);

    TestEnv {
        env,
        client,
        token,
        token_admin,
        org,
        donor,
        donor_two,
        verifiers,
    }
}

fn create_campaign(test: &TestEnv, threshold: u32, amounts: &[i128]) -> u32 {
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
        &String::from_str(&test.env, "ClearFun campaign"),
        &String::from_str(&test.env, "ipfs://campaign"),
        &milestones,
        &test.verifiers,
        &threshold,
        &100,
    )
}

fn mint(test: &TestEnv, donor: &Address, amount: i128) {
    test.token_admin.mint(donor, &amount);
}

fn submit_first_evidence(test: &TestEnv, campaign_id: u32) {
    test.client.submit_evidence(
        &campaign_id,
        &0,
        &BytesN::from_array(&test.env, &[7; 32]),
        &String::from_str(&test.env, "ipfs://evidence"),
    );
}

#[test]
fn happy_path_creates_donates_approves_and_releases() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &campaign_id, &100);
    submit_first_evidence(&test, campaign_id);
    let verifier = test.verifiers.get(0).unwrap();
    test.client.approve_milestone(&verifier, &campaign_id, &0);

    let campaign = test.client.get_campaign(&campaign_id);
    assert_eq!(campaign.total_raised, 100);
    assert_eq!(campaign.total_released, 100);
    assert_eq!(campaign.status, CampaignStatus::Completed);
    assert_eq!(
        test.client.get_milestone(&campaign_id, &0).status,
        MilestoneStatus::Released
    );
    assert_eq!(test.token.balance(&test.org), 100);
    assert_eq!(test.client.get_donation(&campaign_id, &test.donor), 100);
}

#[test]
fn two_of_three_threshold_releases_on_second_approval() {
    let test = setup();
    let campaign_id = create_campaign(&test, 2, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &campaign_id, &100);
    submit_first_evidence(&test, campaign_id);

    test.client
        .approve_milestone(&test.verifiers.get(0).unwrap(), &campaign_id, &0);
    assert_eq!(test.client.get_campaign(&campaign_id).total_released, 0);
    assert_eq!(
        test.client.get_milestone(&campaign_id, &0).approvals.len(),
        1
    );

    test.client
        .approve_milestone(&test.verifiers.get(1).unwrap(), &campaign_id, &0);
    assert_eq!(test.client.get_campaign(&campaign_id).total_released, 100);
}

#[test]
fn duplicate_approval_is_rejected() {
    let test = setup();
    let campaign_id = create_campaign(&test, 2, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &campaign_id, &100);
    submit_first_evidence(&test, campaign_id);

    let verifier = test.verifiers.get(0).unwrap();
    test.client.approve_milestone(&verifier, &campaign_id, &0);
    assert!(test
        .client
        .try_approve_milestone(&verifier, &campaign_id, &0)
        .is_err());
}

#[test]
fn non_verifier_cannot_approve() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &campaign_id, &100);
    submit_first_evidence(&test, campaign_id);

    assert!(test
        .client
        .try_approve_milestone(&test.donor, &campaign_id, &0)
        .is_err());
}

#[test]
fn donation_after_deadline_is_rejected() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100]);
    mint(&test, &test.donor, 100);
    test.env.ledger().with_mut(|ledger| ledger.timestamp = 100);

    assert!(test
        .client
        .try_donate(&test.donor, &campaign_id, &100)
        .is_err());
    assert_eq!(test.token.balance(&test.donor), 100);
}

#[test]
fn two_donors_receive_proportional_refunds_after_partial_release() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100, 100, 100, 100]);
    mint(&test, &test.donor, 100);
    mint(&test, &test.donor_two, 300);
    test.client.donate(&test.donor, &campaign_id, &100);
    test.client.donate(&test.donor_two, &campaign_id, &300);
    submit_first_evidence(&test, campaign_id);
    test.client
        .approve_milestone(&test.verifiers.get(0).unwrap(), &campaign_id, &0);
    test.env.ledger().with_mut(|ledger| ledger.timestamp = 100);

    assert_eq!(test.client.claim_refund(&test.donor, &campaign_id), 75);
    assert_eq!(test.client.claim_refund(&test.donor_two, &campaign_id), 225);
    assert_eq!(test.token.balance(&test.donor), 75);
    assert_eq!(test.token.balance(&test.donor_two), 225);
    assert_eq!(
        test.client.get_campaign(&campaign_id).status,
        CampaignStatus::Expired
    );
    assert!(test
        .client
        .try_claim_refund(&test.donor, &campaign_id)
        .is_err());
}

#[test]
fn a_milestone_cannot_be_released_twice() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100]);
    mint(&test, &test.donor, 100);
    test.client.donate(&test.donor, &campaign_id, &100);
    submit_first_evidence(&test, campaign_id);
    test.client
        .approve_milestone(&test.verifiers.get(0).unwrap(), &campaign_id, &0);

    assert!(test.client.try_release_milestone(&campaign_id, &0).is_err());
    assert_eq!(test.token.balance(&test.org), 100);
}

#[test]
fn evidence_for_later_milestone_requires_earlier_release() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100, 100]);

    assert!(test
        .client
        .try_submit_evidence(
            &campaign_id,
            &1,
            &BytesN::from_array(&test.env, &[7; 32]),
            &String::from_str(&test.env, "ipfs://second"),
        )
        .is_err());
}

#[test]
fn cancellation_is_allowed_only_before_any_donation() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100]);
    test.client.cancel_campaign(&campaign_id);
    assert_eq!(
        test.client.get_campaign(&campaign_id).status,
        CampaignStatus::Cancelled
    );

    let funded_campaign_id = create_campaign(&test, 1, &[100]);
    mint(&test, &test.donor, 1);
    test.client.donate(&test.donor, &funded_campaign_id, &1);
    assert!(test
        .client
        .try_cancel_campaign(&funded_campaign_id)
        .is_err());
}

#[test]
fn missing_authorization_is_rejected() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.try_initialize(&admin).is_err());
}

#[test]
fn approved_milestone_waits_for_funds_and_can_be_released_later() {
    let test = setup();
    let campaign_id = create_campaign(&test, 1, &[100]);
    mint(&test, &test.donor, 50);
    test.client.donate(&test.donor, &campaign_id, &50);
    submit_first_evidence(&test, campaign_id);
    test.client
        .approve_milestone(&test.verifiers.get(0).unwrap(), &campaign_id, &0);
    assert_eq!(test.client.get_campaign(&campaign_id).total_released, 0);
    assert_eq!(
        test.client.get_milestone(&campaign_id, &0).approvals.len(),
        1
    );

    mint(&test, &test.donor_two, 50);
    test.client.donate(&test.donor_two, &campaign_id, &50);
    test.client.release_milestone(&campaign_id, &0);
    assert_eq!(test.client.get_campaign(&campaign_id).total_released, 100);
}

#[test]
fn invalid_campaign_parameters_are_rejected() {
    let test = setup();
    let no_verifiers = Vec::new(&test.env);
    let one_milestone = vec![&test.env, (String::from_str(&test.env, "First"), 100_i128)];
    assert!(test
        .client
        .try_create_campaign(
            &test.org,
            &test.token.address,
            &String::from_str(&test.env, "Invalid"),
            &String::from_str(&test.env, "ipfs://invalid"),
            &one_milestone,
            &no_verifiers,
            &1,
            &100,
        )
        .is_err());

    let repeated_verifiers = vec![
        &test.env,
        test.verifiers.get(0).unwrap(),
        test.verifiers.get(0).unwrap(),
    ];
    assert!(test
        .client
        .try_create_campaign(
            &test.org,
            &test.token.address,
            &String::from_str(&test.env, "Duplicate verifiers"),
            &String::from_str(&test.env, "ipfs://duplicate"),
            &one_milestone,
            &repeated_verifiers,
            &1,
            &100,
        )
        .is_err());

    let organization_as_verifier = vec![&test.env, test.org.clone()];
    assert!(test
        .client
        .try_create_campaign(
            &test.org,
            &test.token.address,
            &String::from_str(&test.env, "Organization verifier"),
            &String::from_str(&test.env, "ipfs://organization"),
            &one_milestone,
            &organization_as_verifier,
            &1,
            &100,
        )
        .is_err());
}
