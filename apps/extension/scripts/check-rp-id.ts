#!/usr/bin/env bun
// Build-step gate: verify the WebAuthn RP_ID constant is in sync with
// the manifest's host_permissions AND that no source file outside the
// constant's definition site contains a string literal of the RP_ID
// value.
//
// Runs BEFORE vite build (see package.json build script). Reads the
// SOURCE manifest config, not the built dist manifest.
//
// Usage: bun run check:rp-id (from apps/extension package dir).
//
// Exit code 0 on success, 1 on any drift or mismatch.

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import ManifestConfig from "../manifest/manifest.config"
import { scanRpIdLiteralDrift, validateHostPermissions } from "../src/wallet/services/passkey/check-rp-id"
import { RP_ID } from "../src/wallet/services/passkey/spec"

const ROOT = resolve(__dirname, "..")

// Files known to legitimately contain RP_ID references. Add entries
// here when a new file consumes the RP ID; the gate verifies it does
// not drift to a literal.
const PASSKEY_FILES: ReadonlyArray<{ path: string; excludeDefinition?: boolean }> = [
	{ path: "src/wallet/services/passkey/spec.ts", excludeDefinition: true },
	{ path: "src/popup/windows/passkey/index.vue" },
]

let failed = false

console.log("[check-rp-id] verifying RP_ID =", JSON.stringify(RP_ID))

const manifestResult = validateHostPermissions(ManifestConfig, RP_ID)
if (!manifestResult.ok) {
	console.error("[check-rp-id] manifest mismatch:", manifestResult.error)
	if (manifestResult.details) {
		console.error("    details:", JSON.stringify(manifestResult.details, null, 2))
	}
	failed = true
} else {
	console.log("[check-rp-id] manifest host_permissions OK")
}

for (const { path, excludeDefinition } of PASSKEY_FILES) {
	const fullPath = join(ROOT, path)
	let content: string
	try {
		content = readFileSync(fullPath, "utf8")
	} catch (err) {
		console.error(`[check-rp-id] cannot read ${path}:`, err instanceof Error ? err.message : err)
		failed = true
		continue
	}
	const findings = scanRpIdLiteralDrift(path, content, RP_ID, { excludeDefinition })
	if (findings.length === 0) {
		console.log(`[check-rp-id] ${path} clean`)
	} else {
		failed = true
		for (const f of findings) {
			console.error(`[check-rp-id] DRIFT  ${f.file}:${f.line}  literal "${f.literal}" -- use RP_ID instead`)
			console.error(`           context: ${f.context}`)
		}
	}
}

if (failed) {
	console.error("[check-rp-id] FAILED -- fix the above and rerun")
	process.exit(1)
}

console.log("[check-rp-id] OK")
