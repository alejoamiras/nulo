// claim_public / claim_private behavior under TXE: happy paths, and every failure mode the
// circuit must enforce (wrong secret, wrong recipient, paused bridge, nullifier replay).

use super::utils;
use crate::TokenBridge;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::test_environment::TestEnvironment,
};
use token::Token;

/// Happy path: an L1 deposit message consumed publicly mints to `to` and nothing else.
#[test]
unconstrained fn claim_public_mints_to_recipient() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf));

    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), amount);
}

/// A claim naming a DIFFERENT recipient derives a different content hash — unconsumable.
#[test(should_fail)]
unconstrained fn claim_public_wrong_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let other = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    // Message bound to `to`; claim attempts to redirect to `other`.
    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(other, amount, secret, leaf));
}

/// A wrong consumption secret fails the message-membership check.
#[test(should_fail)]
unconstrained fn claim_public_wrong_secret_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;

    let leaf = utils::send_mint_to_public_message(env, to, amount, 42, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, 43, leaf));
}

/// Nullifier replay: the same leaf cannot fund two claims.
#[test(should_fail)]
unconstrained fn claim_public_double_claim_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 7;

    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf));
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf));
}

/// The owner's pause gate blocks public claims.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn claim_public_paused_rejected() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf));
}

/// Zero-amount claims are rejected before any messaging.
#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn claim_public_zero_amount_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 0, 42, 0));
}
