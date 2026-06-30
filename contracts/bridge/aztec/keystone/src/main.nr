// KEYSTONE: proves the Noir content-hashes equal the L1 (Solidity) ones for
// fixed vectors. The matching L1 assertions live in bridge-evm
// (test/ContentHash.t.sol) against the SAME constants. Equality across both
// toolchains is the one cross-chain boundary guard the TXE can't provide: if a
// selector or arg order ever drifts, a deposit's L1->L2 message becomes
// unconsumable and funds strand. Run: nargo test (with the rc.2 nargo).

use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::protocol::traits::FromField;
use token_portal_content_hash_lib::{
    get_mint_to_private_content_hash, get_mint_to_public_content_hash, get_withdraw_content_hash,
};

fn main() {}

#[test]
fn mint_to_public_matches_l1() {
    let to = AztecAddress::from_field(0x1234);
    let h = get_mint_to_public_content_hash(to, 1_000_000);
    assert(h == 0x00fb464b41c6a08b28bfe9b8a11c1c4dcd2d4c9c66e703988cb76eb00e140dcc);
}

#[test]
fn mint_to_private_matches_l1() {
    let h = get_mint_to_private_content_hash(1_000_000);
    assert(h == 0x00009b1ee836fa551bb50bb45e2c8e698cc680c6e68e429370625119a2c63954);
}

#[test]
fn withdraw_matches_l1() {
    let recipient = EthAddress::from_field(0xBEEF);
    let caller = EthAddress::zero();
    let h = get_withdraw_content_hash(recipient, 1_000_000, caller);
    assert(h == 0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775);
}
