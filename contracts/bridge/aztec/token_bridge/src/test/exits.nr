// exit_to_l1_public / exit_to_l1_private: burn the user's tokens and enqueue the L2→L1 withdraw
// message. TXE has no outgoing-message oracle, so the burn side-effect is the assertion surface;
// the message CONTENT is pinned separately by the keystone + ContentHash.t.sol pair.

use super::utils;
use crate::TokenBridge;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::{authwit::add_private_authwit_from_call, authwit::add_public_authwit_from_call, test_environment::TestEnvironment},
};
use token::Token;
use claim_secret_lib::derive_claim_secret;
use token_portal_content_hash_lib::get_mint_to_private_content_hash;

global NONCE: Field = 7;

/// Public exit: the user's public balance burns by exactly the exited amount.
#[test]
unconstrained fn exit_to_l1_public_burns_caller_balance() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let user = env.create_light_account();
    let minted: u128 = 2_000_000;
    let exit_amount: u128 = 700_000;
    let recipient = aztec::protocol::address::EthAddress::from_field(0xBEEF);

    // Fund via a public claim (the bridge mints through the proxy).
    let leaf = utils::send_mint_to_public_message(env, user, minted, 42, bridge);
    env.call_public(user, TokenBridge::at(bridge).claim_public(user, minted, 42, leaf));

    // The token sees msg_sender == PROXY, so the user must publicly authorize the proxy for
    // burn_public(user, amount, nonce) — same shape the wallet's authwit flow produces.
    add_public_authwit_from_call(
        env,
        user,
        _proxy,
        Token::at(token).burn_public(user, exit_amount, NONCE),
    );
    env.call_public(
        user,
        TokenBridge::at(bridge).exit_to_l1_public(recipient, exit_amount, aztec::protocol::address::EthAddress::zero(), NONCE),
    );

    assert_eq(env.view_public(Token::at(token).balance_of_public(user)), minted - exit_amount);
}

/// Private exit: burns from the user's private notes; relayer-submittable like claims.
#[test]
unconstrained fn exit_to_l1_private_burns_private_balance() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account(); // full keys for private note spending
    let minted: u128 = 900_000;
    let exit_amount: u128 = 400_000;
    let salt = 555;
    let recipient = aztec::protocol::address::EthAddress::from_field(0xCAFE);

    let content = get_mint_to_private_content_hash(minted);
    let secret_hash = aztec::hash::compute_secret_hash([derive_claim_secret(salt, user)]);
    let leaf = env.send_l1_to_l2_message_from_secret_hash(content, secret_hash, utils::portal(), bridge);
    env.call_private(user, TokenBridge::at(bridge).claim_private(user, minted, salt, leaf));

    add_private_authwit_from_call(
        env,
        user,
        _proxy,
        Token::at(token).burn_private(user, exit_amount, NONCE),
    );
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(recipient, exit_amount, aztec::protocol::address::EthAddress::zero(), NONCE),
    );

    assert_eq(env.execute_utility(Token::at(token).balance_of_private(user)), minted - exit_amount);
}

/// A paused bridge refuses public exits.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn exit_to_l1_public_paused_rejected() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_light_account();

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(
        user,
        TokenBridge::at(bridge).exit_to_l1_public(
            aztec::protocol::address::EthAddress::from_field(0xBEEF),
            1,
            aztec::protocol::address::EthAddress::zero(),
            NONCE,
        ),
    );
}

/// Zero L1 recipient is rejected before authwit evaluation or burning.
#[test(should_fail_with = "Recipient cannot be zero")]
unconstrained fn exit_to_l1_public_zero_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_light_account();
    env.call_public(
        user,
        TokenBridge::at(bridge).exit_to_l1_public(
            aztec::protocol::address::EthAddress::zero(),
            1,
            aztec::protocol::address::EthAddress::zero(),
            NONCE,
        ),
    );
}

/// The private exit carries the same two guards as the public one, reached through the
/// enqueued public assert rather than inline. Only the public path was covered, so a
/// regression that dropped either guard from the private entrypoint would have gone unseen.
/// Funded and authorized before pausing: the private exit's pause gate runs in the ENQUEUED
/// public assert, so the private phase (note nullification, authwit) must succeed first.
/// Without the balance the test would fail on the missing note and prove nothing about pause.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn exit_to_l1_private_paused_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 500_000, 4242, bridge);

    add_private_authwit_from_call(env, user, _proxy, Token::at(token).burn_private(user, 1, NONCE));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(
            aztec::protocol::address::EthAddress::from_field(0xBEEF),
            1,
            aztec::protocol::address::EthAddress::zero(),
            NONCE,
        ),
    );
}

#[test(should_fail_with = "Recipient cannot be zero")]
unconstrained fn exit_to_l1_private_zero_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(
            aztec::protocol::address::EthAddress::zero(),
            1,
            aztec::protocol::address::EthAddress::zero(),
            NONCE,
        ),
    );
}

/// Exiting more than the caller holds must fail on the burn rather than emitting an L2→L1
/// withdraw message for value that was never destroyed — the shape that would let a user
/// exit twice against one balance.
#[test(should_fail_with = "attempt to subtract with overflow")]
unconstrained fn exit_to_l1_public_insufficient_balance_rejected() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let user = env.create_light_account();
    let minted: u128 = 100_000;
    let recipient = aztec::protocol::address::EthAddress::from_field(0xBEEF);

    let leaf = utils::send_mint_to_public_message(env, user, minted, 42, bridge);
    env.call_public(user, TokenBridge::at(bridge).claim_public(user, minted, 42, leaf));

    add_public_authwit_from_call(
        env,
        user,
        _proxy,
        Token::at(token).burn_public(user, minted + 1, NONCE),
    );
    env.call_public(
        user,
        TokenBridge::at(bridge).exit_to_l1_public(recipient, minted + 1, aztec::protocol::address::EthAddress::zero(), NONCE),
    );
}
