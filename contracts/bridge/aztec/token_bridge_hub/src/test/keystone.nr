// KEYSTONE (no TXE): the hub's in-circuit Token derivation must equal bridge-core's
// `deriveHubTokenInstance` (aztec.js `getContractInstanceFromInstantiationParams`) for a fixed
// vector. Both sides compute the address independently; a drift means the app registers an
// instance the hub will never mint to. Run with a name filter so the oracle-less runner skips
// the TXE suite: `aztec-nargo test keystone`.
use crate::TokenBridgeHub;
use aztec::protocol::{
    address::{AztecAddress, EthAddress}, contract_class_id::ContractClassId, traits::{FromField, ToField},
};

// The installed aztec-standards@5.0.1 Token class — pinned in bridge-core's
// noir-artifact-classids.test.ts as well.
global TOKEN_CLASS_ID: Field = 0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf;

#[test]
fn keystone_hub_token_address_matches_bridge_core() {
    let hub = AztecAddress::from_field(0x1234000000000000000000000000000000000000000000000000000000000abc);
    let erc20 = EthAddress::from_field(0xe2c20);
    let name_word = 0x004e756c6f205465737420546f6b656e00000000000000000000000000000000;
    let symbol_word = 0x004e545400000000000000000000000000000000000000000000000000000000;
    let name = TokenBridgeHub::word_to_str(name_word);
    let symbol = TokenBridgeHub::word_to_str(symbol_word);
    let token = TokenBridgeHub::derive_token(
        hub,
        ContractClassId::from_field(TOKEN_CLASS_ID),
        erc20,
        name,
        symbol,
        18,
    );
    assert(
        token.to_field() == 0x16d03942b8ae31464284482ee43727e40718773358bf324c5c287f52a63b573d,
    );
}

// `to_be_bytes::<31>` range-checks the word before the round-trip assert can even run: a value that
// does not fit 31 bytes fails to decompose.
#[test(should_fail_with = "Field failed to decompose into specified 31 limbs")]
fn keystone_oversized_word_is_rejected() {
    let _ = TokenBridgeHub::word_to_str(0x0100000000000000000000000000000000000000000000000000000000000000);
}
