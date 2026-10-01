/**
 * The vendored Schnorr account artifact — a frozen input to Nulo account addresses.
 *
 * Account addresses embed this artifact's contract class id. Upstream rebuilds its artifacts on
 * any toolchain or bytecode change, which shifts class ids across Aztec bumps and would
 * strand every stored account behind an address the wallet can no longer re-derive. The
 * address-bearing copy is therefore vendored in-repo (never bumped with the Aztec line) and
 * pinned by digest + class id in `artifact-freeze.test.ts`; provenance lives in
 * `artifacts/PROVENANCE.md`.
 *
 * The JSON→artifact interpretation (`loadContractArtifact`) and the class-id hash computation
 * remain upstream code: the class-id pin is a TRIPWIRE for that path, not a freeze of it.
 */
import type { ContractArtifact } from "@aztec-labs/stdlib/abi"
import { loadContractArtifact } from "@aztec-labs/stdlib/abi"
import type { NoirCompiledContract } from "@aztec-labs/stdlib/noir"
import SchnorrAccountJson from "./artifacts/SchnorrAccount.json"

/** sha256 of the vendored `artifacts/SchnorrAccount.json` bytes. */
export const FROZEN_ARTIFACT_SHA256 = "4b4933a146a80872b184f47af22cd8ba3faa00f810d7a26217490c9d13507f94"

/** Contract class id of the loaded artifact — the address-visible identity of the account code. */
export const FROZEN_ACCOUNT_CLASS_ID = "0x010cc0891c8748de2009734bf117485efbaf3aad0be125f151b4e6744f8f1842"

export const FrozenSchnorrAccountArtifact: ContractArtifact = loadContractArtifact(SchnorrAccountJson as unknown as NoirCompiledContract)
