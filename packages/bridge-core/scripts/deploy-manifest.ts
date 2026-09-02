/**
 * Durable artifacts for the bridge cutover deploy: a write-ahead JOURNAL (the authoritative resume
 * record) and an atomically-written CANDIDATE manifest.
 *
 * Why both (per the codex review of the cutover design, session 019ecbee):
 * - The deploy is one-shot and irreversible. The journal records every step BEFORE and AFTER its tx
 *   lands so a crash is recoverable; the post-deploy manifest alone is too late. Once the portal is
 *   `initialize`d it is married to one exact L2 bridge, so resume must reuse the WHOLE recorded
 *   generation (salts + addresses) - never fresh salts mid-flight.
 * - The deploy writes a CANDIDATE, never the live `testnet-bridge.json`. "Write nothing on a failed
 *   read-back" is not a rollback (it would leave the app on the old/vulnerable bridge); promotion of
 *   the candidate to live is the deliberate cutover step.
 *
 * Durability: the journal is fsync'd after every append and the candidate is written to a same-dir
 * sibling temp (0600) + fsync + atomic rename(2); the parent dir is fsync'd after each mutation so
 * the rename/append survives a crash.
 */
import { randomBytes } from "node:crypto"
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseCandidateManifest } from "../src/candidate-schema"

export interface L2Record {
	address: string
	salt: number
	constructorArtifact: string
	constructorArgs: unknown[]
}

/** Shape consumed by the tools app reader (bridge-deployments.ts) - keep every field it reads. */
export interface CandidateManifest {
	network: string
	/** Chain identity — the startup build-integrity assertion requires these, so a promoted candidate
	 *  MUST carry them or the deployed app rejects the manifest at boot (codex post-impl HIGH-3). */
	l1ChainId?: number
	walletChainId?: number
	l1: {
		usdc: string
		portal: string
		portalSource: "forked-v1"
		/** L9 runtime interlock — "salt-v2" marks a recipient-committed deployment; the deposit code
		 *  refuses private deposits without it. Written only into candidate/promoted manifests. */
		privateClaimMode?: "salt-v2"
		token: {
			name: string
			symbol: string
			decimals: number
			maxWholePerTx?: number
			source?: "permissionless-mint" | "circle-proxy"
			sourceContract?: "MintableERC20" | "TestUsdc"
		}
		fuel?: Record<string, unknown>
		/** Direct Fee-Juice bridge config — the tools app's Fuel tab reads exactly these keys
		 *  (bridge-deployments.ts). Omitting it from a promotion silently disables direct Fuel. */
		feeJuice?: { portal: string; asset: string; feeAssetHandler?: string; minFj: string }
	}
	l2: { proxy: L2Record; token: L2Record; bridge: L2Record }
}

/** fsync a directory so a create/rename/append is durable across a crash. */
function fsyncDir(dir: string): void {
	const dfd = openSync(dir, "r")
	try {
		fsyncSync(dfd)
	} finally {
		closeSync(dfd)
	}
}

/** Write JSON to a same-dir sibling temp (0600) + fsync + atomic rename + parent-dir fsync.
 *  The manifest is STRICT-validated first — a malformed candidate never reaches disk. */
export function writeCandidateAtomic(targetPath: string, manifest: CandidateManifest): void {
	parseCandidateManifest(manifest)
	const dir = dirname(targetPath)
	const tmp = join(dir, `.${randomBytes(9).toString("hex")}.candidate.tmp`)
	const fd = openSync(tmp, "wx", 0o600)
	try {
		writeSync(fd, `${JSON.stringify(manifest, null, "\t")}\n`)
		fsyncSync(fd)
	} finally {
		closeSync(fd)
	}
	renameSync(tmp, targetPath)
	fsyncDir(dir)
}

/**
 * One write-ahead-journal line. `generation` seeds the run's salts; `submitted` records a tx hash
 * before its receipt is awaited; `confirmed` records the landed address (or "done" for a wiring tx).
 */
export interface JournalEntry {
	ts: string
	phase: "generation" | "submitted" | "confirmed"
	step?: string
	txHash?: string
	address?: string
	salts?: { proxy: number; token: number; bridge: number }
}

/** Append one line + fsync the file and its parent dir. */
export function appendJournal(path: string, entry: Omit<JournalEntry, "ts">): void {
	const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
	const fd = openSync(path, "a", 0o600)
	try {
		writeSync(fd, line)
		fsyncSync(fd)
	} finally {
		closeSync(fd)
	}
	fsyncDir(dirname(path))
}

export function readJournal(path: string): JournalEntry[] {
	if (!existsSync(path)) return []
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as JournalEntry)
}

export interface GenerationState {
	salts: { proxy: number; token: number; bridge: number }
	confirmed: Record<string, string>
	portalInitialized: boolean
}

/**
 * Reconstruct the recorded generation from a journal. Returns null for an empty journal (clean
 * start). A non-null result MUST be resumed (never started fresh) - the caller enforces codex's rule
 * that fresh salts after a confirmed portal-init are forbidden.
 */
export function resolveResume(journal: JournalEntry[]): GenerationState | null {
	const gen = journal.find((e) => e.phase === "generation" && e.salts)
	if (!gen?.salts) return null
	const confirmed: Record<string, string> = {}
	for (const e of journal) if (e.phase === "confirmed" && e.step) confirmed[e.step] = e.address ?? "done"
	return { salts: gen.salts, confirmed, portalInitialized: "portal-init" in confirmed }
}

/** The viem client surface `journaledEvmDeploy` needs — narrow so tests drive it with fakes. */
export interface EvmDeployClients {
	wallet: { deployContract: (a: { abi: never; bytecode: `0x${string}`; args: never }) => Promise<`0x${string}`> }
	pub: { waitForTransactionReceipt: (a: { hash: `0x${string}` }) => Promise<{ contractAddress?: `0x${string}` | null }> }
}

/**
 * One journaled EVM contract deploy — the write-ahead bracket both bridge conductors use for
 * their fresh-deploy path: journal `submitted` with the tx hash BEFORE the receipt is awaited
 * (the durable recovery key), then `confirmed` with the landed address. Resume/from-journal
 * short-circuits stay at the call site — this is only the fresh landing.
 */
export async function journaledEvmDeploy(
	clients: EvmDeployClients,
	journalPath: string,
	step: string,
	name: string,
	art: { abi: unknown; bytecode: `0x${string}` },
	args: unknown[],
	log: (address: `0x${string}`) => void = () => {},
): Promise<`0x${string}`> {
	const hash = await clients.wallet.deployContract({ abi: art.abi as never, bytecode: art.bytecode, args: args as never })
	appendJournal(journalPath, { phase: "submitted", step, txHash: hash })
	const r = await clients.pub.waitForTransactionReceipt({ hash })
	if (!r.contractAddress) throw new Error(`${name}: no contractAddress`)
	appendJournal(journalPath, { phase: "confirmed", step, address: r.contractAddress })
	log(r.contractAddress)
	return r.contractAddress
}
