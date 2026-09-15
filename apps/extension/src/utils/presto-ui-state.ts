/**
 * Presto status → what a Nulo surface shows. Pure: the SDK status comes in,
 * a state plus copy comes out. The state names are the banner package's own
 * (`stateFromStatus`), so the `<presto-banner>` card and Nulo's status card
 * always agree on which situation the user is in; the copy is Presto's
 * canonical strings where a state has one, extended with Nulo's numbered
 * recovery steps.
 */
import { type BannerState, STRINGS, stateFromStatus } from "@alejoamiras/presto-banners"
import type { PrestoStatus, SecureConnectionDiagnosis } from "@alejoamiras/presto-core"
import type { LastProveOutcome } from "@/wallet/services/execution/models"

/** Facts the health body carries. The version fields are absent on the minimal body Presto
 *  serves an origin it has not approved yet; `protocol` is the scheme that answered, so it is
 *  known whenever anything answered. */
export interface PrestoInfo {
	appVersion?: string
	nativeAztecVersion?: string
	protocol?: "http" | "https"
}

export type PrestoUiState =
	| { kind: "idle" }
	| { kind: "detecting" }
	| { kind: BannerState; diagnosis?: SecureConnectionDiagnosis; info: PrestoInfo }

/** Colour role of a card: `go` proves natively, `accent` will after a download, `warn` needs
 *  the user, `off` is the browser fallback, `pending` is a probe in flight. */
export type PrestoTone = "pending" | "go" | "accent" | "warn" | "off"

export interface PrestoCopy {
	tone: PrestoTone
	title: string
	detail: string
	steps?: string[]
	retry?: "Test" | "Retry" | "Re-test"
}

/** The onboarding step has room for the full recovery copy; the settings page is compact. */
export type PrestoSurface = "onboarding" | "settings"

export function uiStateFromStatus(status: PrestoStatus): PrestoUiState {
	const kind = stateFromStatus(status)
	if (status.available) {
		return { kind, info: { appVersion: status.appVersion, nativeAztecVersion: status.nativeAztecVersion, protocol: status.protocol } }
	}
	switch (status.reason) {
		case "secure-connection-unavailable":
			// `unconfirmed` maps to `offline` (the install pitch); the other diagnoses keep their arm.
			return kind === "secure-connection-unavailable" ? { kind, diagnosis: status.diagnosis, info: {} } : { kind, info: {} }
		case "version-mismatch":
			return { kind, info: { nativeAztecVersion: status.nativeAztecVersion, protocol: status.protocol } }
		case "error":
			return { kind, info: { protocol: status.protocol } }
		default:
			return { kind, info: {} }
	}
}

const PRESTO_SETTINGS_STEP = "Open Presto from your menu bar and go to Settings."

const SECURE_CONNECTION_COPY: Record<SecureConnectionDiagnosis, { detail: string; steps: string[] }> = {
	"presto-reachable": {
		detail: "Presto is running but the encrypted connection isn't reachable. Nulo only hands proofs to Presto over HTTPS.",
		steps: [
			PRESTO_SETTINGS_STEP,
			"Turn on Encrypted Connection.",
			"If Presto asks, run the certificate setup again, then press Retry.",
		],
	},
	"https-disabled": {
		detail: "Nulo only hands proofs to Presto over HTTPS.",
		steps: [
			PRESTO_SETTINGS_STEP,
			"Turn on Encrypted Connection.",
			"If Presto asks, run the certificate setup again, then press Retry.",
		],
	},
	"tls-or-trust-failure": {
		detail: "Your browser doesn't trust Presto's certificate yet.",
		steps: [PRESTO_SETTINGS_STEP, "Run the certificate setup again.", "Press Retry."],
	},
	// Unreachable here (`unconfirmed` becomes the `offline` pitch); kept so the record is total.
	unconfirmed: {
		detail: "Nulo only hands proofs to Presto over HTTPS.",
		steps: [PRESTO_SETTINGS_STEP, "Turn on Encrypted Connection.", "Press Retry."],
	},
}

const PERMISSION_BLOCKED_COPY: Record<PrestoSurface, Omit<PrestoCopy, "tone" | "retry">> = {
	onboarding: {
		title: STRINGS["permission-blocked"].title,
		detail: "Allow local network access for Nulo, then retry.",
		steps: [
			"Click the site-permissions icon at the left of the address bar.",
			"Set Local network (Chrome 145+: Loopback network) to Allow.",
			"Come back here and press Retry.",
		],
	},
	settings: {
		title: "Browser blocked local access",
		detail: "Proofs run in your browser until it's allowed.",
		steps: ["Open Nulo's site permissions from the address bar.", "Set Local network to Allow.", "Press Retry."],
	},
}

function connectedDetail(info: PrestoInfo, surface: PrestoSurface): string {
	const parts = ["Proving natively"]
	if (info.appVersion) parts.push(`Presto ${info.appVersion}`)
	// The settings page lists the runtime and the connection in its Details rows.
	if (surface === "onboarding" && info.nativeAztecVersion) parts.push(`Aztec ${info.nativeAztecVersion}`)
	if (surface === "onboarding" && info.protocol === "https") parts.push("encrypted")
	return parts.join(" · ")
}

/**
 * Copy for a state. `last` is the SW's memory of the latest prove attempt:
 * a remembered denial overlays `available`, because health alone cannot see
 * that Presto's per-origin prompt was declined. The overlay says "declined
 * earlier" — it is history, not a statement about approval now.
 */
export function copyFor(state: PrestoUiState, last?: LastProveOutcome | null, surface: PrestoSurface = "onboarding"): PrestoCopy {
	switch (state.kind) {
		case "idle":
		case "detecting":
			return { tone: "pending", title: "Looking…", detail: "" }
		case "available":
			if (last?.denial) {
				return {
					tone: "warn",
					title: "Presto declined Nulo earlier",
					detail: "Approval is confirmed by your next transaction; Re-test only re-checks that Presto is running.",
					steps: ["Wait about 30 seconds, then send again and choose Allow in Presto's prompt."],
					retry: "Re-test",
				}
			}
			return { tone: "go", title: STRINGS.available.title, detail: connectedDetail(state.info, surface), retry: "Re-test" }
		case "downloading":
			return {
				tone: "accent",
				title: STRINGS.available.title,
				detail: "It needs a one-time download for this Aztec version, which starts with your next proof.",
				retry: "Re-test",
			}
		case "offline":
			return { tone: "off", title: "Presto not detected", detail: "Proofs run in your browser (slower).", retry: "Test" }
		case "permission-blocked":
			return { tone: "warn", ...PERMISSION_BLOCKED_COPY[surface], retry: "Retry" }
		case "secure-connection-unavailable": {
			const { detail, steps } = SECURE_CONNECTION_COPY[state.diagnosis ?? "presto-reachable"]
			return { tone: "warn", title: STRINGS["secure-connection-unavailable"].title, detail, steps, retry: "Retry" }
		}
		case "version-mismatch":
			return {
				tone: "warn",
				title: STRINGS["version-mismatch"].title,
				detail: state.info.nativeAztecVersion
					? `Presto runs Aztec ${state.info.nativeAztecVersion}; Nulo needs ${__AZTEC_VERSION__}. ${STRINGS["version-mismatch"].support}.`
					: `${STRINGS["version-mismatch"].support}.`,
				retry: "Retry",
			}
		default:
			return { tone: "warn", title: STRINGS.error.title, detail: `${STRINGS.error.support}.`, retry: "Retry" }
	}
}

/** The settings index row's one-line description. */
export function rowDescriptionFor(state: PrestoUiState, last?: LastProveOutcome | null): string {
	switch (state.kind) {
		case "idle":
		case "detecting":
			return "Checking Presto…"
		case "available":
			return last?.denial ? "Presto · approval needed" : "Presto · connected"
		case "downloading":
			return "Presto · one-time download pending"
		case "offline":
			return "In browser · Presto not detected"
		case "permission-blocked":
			return "Browser blocked local access"
		case "secure-connection-unavailable":
			return "Presto · encrypted connection unavailable"
		case "version-mismatch":
			return "Presto · update needed"
		default:
			return "Presto · not responding"
	}
}

export interface PrestoDetailRow {
	title: string
	description: string
	icon: string
	value: string
}

function connectionLabel(state: PrestoUiState): string {
	if (state.kind === "permission-blocked") return "Blocked"
	if (state.kind === "idle" || state.kind === "detecting") return "—"
	if (state.info.protocol === "https") return "Encrypted"
	if (state.info.protocol === "http") return "Plain HTTP"
	return "—"
}

/** The settings page's Details rows; the version rows read `—` on the minimal health body. */
export function detailRowsFor(state: PrestoUiState): PrestoDetailRow[] {
	const info = "info" in state ? state.info : {}
	return [
		{ title: "Presto", description: "Menu-bar app", icon: "memory", value: info.appVersion ?? "—" },
		{ title: "Aztec runtime", description: "Prover version", icon: "layers", value: info.nativeAztecVersion ?? "—" },
		{ title: "Connection", description: "Loopback, this machine only", icon: "lan", value: connectionLabel(state) },
	]
}
