// TokenMinterProxy guards: after the one-shot wiring, the bridge is the ONLY mint/burn caller
// and the owner retains no standing authority (F-002).

use super::utils;
use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};
use token_minter_proxy::TokenMinterProxy;

/// A random account calling the proxy directly is rejected — only the bridge mints.
#[test(should_fail_with = "not the bridge")]
unconstrained fn proxy_direct_mint_rejected() {
    let (mut env, _admin, proxy, _token, _bridge) = utils::setup();
    let rando = env.create_light_account();
    env.call_public(rando, TokenMinterProxy::at(proxy).mint_to_public(rando, 1));
}

/// Even the PROXY OWNER cannot mint — the wiring is single-shot by construction.
#[test(should_fail_with = "not the bridge")]
unconstrained fn proxy_owner_cannot_mint() {
    let (mut env, admin, proxy, _token, _bridge) = utils::setup();
    env.call_public(admin, TokenMinterProxy::at(proxy).mint_to_public(admin, 1));
}

/// set_bridge is single-shot: a second call reverts on the PublicImmutable guard (F-002 — the
/// sole minter can never be repointed or extended, even by the owner).
#[test(should_fail)]
unconstrained fn proxy_set_bridge_second_call_reverts() {
    let (mut env, admin, proxy, _token, _bridge) = utils::setup();
    let other = env.create_light_account();
    env.call_public(admin, TokenMinterProxy::at(proxy).set_bridge(other));
}
