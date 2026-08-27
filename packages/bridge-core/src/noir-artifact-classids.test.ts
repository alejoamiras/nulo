import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { DripperContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { describe, expect, it } from "vitest"

/**
 * Supply-chain tripwire (codex ultra-audit HIGH #2): the committed bridge Noir
 * artifacts are NOT reproducibly bound to source — CI has no nargo, Nargo.toml pins
 * mutable git tags, and the multi-MiB JSONs merely self-report `aztec_version`. A
 * stale or hand-edited-yet-valid artifact would otherwise survive CI and become the
 * runtime + deploy input. This pins each artifact's DERIVED class id (bytecode + ABI,
 * the on-chain identity) AND its sha256 to the values recorded when they were compiled
 * from the pinned 5.0.1 toolchain + AztecProtocol/aztec-standards@v5.0.1 (peeled
 * commits in lessons/phase-p4.md). ANY drift in the committed bytes trips this before
 * a live deploy consumes them. Regenerate ONLY via `contracts/bridge/aztec/scripts/
 * compile.sh` on the pinned toolchain, then update the pins here consciously.
 */

const here = dirname(fileURLToPath(import.meta.url))
const CONTRACTS = join(here, "..", "..", "..", "contracts", "bridge", "aztec")

const PINS = [
	{
		name: "TokenMinterProxy",
		path: join(CONTRACTS, "token_minter_proxy", "target", "token_minter_proxy-TokenMinterProxy.json"),
		classId: "0x07689a539bf0a60a252f9b88406d5a4b129f192f7da37ab181c7a2be6910524a",
	},
	{
		// The recipient-committed TokenBridge (claim_private takes claim_salt + derives the consumption
		// secret in-circuit) — a DIFFERENT class id from dev's bearer bridge. Regenerated via compile.sh
		// on the pinned 5.0.1 toolchain; keystone crypto vectors re-validated on 5.0.1 (unchanged).
		name: "TokenBridge",
		path: join(CONTRACTS, "token_bridge", "target", "token_bridge_contract-TokenBridge.json"),
		classId: "0x2cb5c6341bbae9bb0e78b64cfdd724cb493cc35dca46b122280fdf223b3d8713",
	},
] as const

describe("committed bridge Noir artifacts — class-id + digest tripwire (5.0.1)", () => {
	for (const pin of PINS) {
		it(`${pin.name} derives its pinned class id`, async () => {
			const artifact = loadContractArtifact(JSON.parse(readFileSync(pin.path, "utf8")))
			const cls = await getContractClassFromArtifact(artifact)
			expect(cls.id.toString()).toBe(pin.classId)
		})
	}

	it("both artifacts self-report aztec_version 5.0.1", () => {
		for (const pin of PINS) {
			const raw = JSON.parse(readFileSync(pin.path, "utf8")) as { aztecVersion?: string; aztec_version?: string }
			expect(raw.aztecVersion ?? raw.aztec_version).toBe("5.0.1")
		}
	})
})

/**
 * Standards package tripwire (codex ultra-audit MEDIUM #4): the lockfile byte-pins
 * `@aztec-foundation/aztec-standards` by SHA-512, but a lock regeneration accepts new
 * integrity, and `descriptors-real-artifact.test.ts` only checks ABI shape (a
 * bytecode-tampered artifact retaining its ABI passes). Pinning the DERIVED class ids
 * of the runtime-loaded Token + Dripper artifacts binds their on-chain IDENTITY — the
 * wallet, faucet, and bridge all register instances from these exact bytes.
 */
describe("installed aztec-standards Token/Dripper — class-id tripwire (5.0.1)", () => {
	const STANDARDS = [
		{ name: "Token", artifact: TokenContractArtifact, classId: "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf" },
		{
			name: "Dripper",
			artifact: DripperContractArtifact,
			classId: "0x0cdecf89d09580e1e8e51fba6c35f8a6981f2ee00b1d8ebab8ddc0df45fefe39",
		},
	] as const
	for (const std of STANDARDS) {
		it(`${std.name} derives its pinned class id`, async () => {
			const cls = await getContractClassFromArtifact(loadContractArtifact(std.artifact as never))
			expect(cls.id.toString()).toBe(std.classId)
		})
	}
})
