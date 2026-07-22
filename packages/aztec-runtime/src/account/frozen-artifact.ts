/**
 * The vendored Schnorr account artifact — a frozen input to Nulo account addresses.
 *
 * Account addresses embed this artifact's contract class id. Upstream rebuilds its artifacts on
 * any toolchain or bytecode change, which shifts class ids across `@aztec/*` bumps and would
 * strand every stored account behind an address the wallet can no longer re-derive. The
 * address-bearing copy is therefore vendored in-repo (never bumped with the `@aztec/*` line) and
 * pinned by digest + class id in `artifact-freeze.test.ts`; provenance lives in
 * `artifacts/PROVENANCE.md`.
 *
 * The JSON→artifact interpretation (`loadContractArtifact`) and the class-id hash computation
 * remain upstream code: the class-id pin is a TRIPWIRE for that path, not a freeze of it.
 */
import type { ContractArtifact } from "@aztec/stdlib/abi"
import { loadContractArtifact } from "@aztec/stdlib/abi"
import type { NoirCompiledContract } from "@aztec/stdlib/noir"
import SchnorrAccountJson from "./artifacts/SchnorrAccount.json"

/** sha256 of the vendored `artifacts/SchnorrAccount.json` bytes. */
export const FROZEN_ARTIFACT_SHA256 = "36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63"

/** Contract class id of the loaded artifact — the address-visible identity of the account code. */
export const FROZEN_ACCOUNT_CLASS_ID = "0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5"

export const FrozenSchnorrAccountArtifact: ContractArtifact = loadContractArtifact(SchnorrAccountJson as unknown as NoirCompiledContract)
