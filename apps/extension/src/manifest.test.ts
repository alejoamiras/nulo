import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import logoDataUri from "@/assets/logo.png?inline"
import manifest from "../manifest/manifest.config"
import firefoxManifest from "../manifest/manifest.firefox.config"
import { RP_ID } from "@/wallet/services/passkey/spec"

type ContentScript = { matches: string[]; exclude_matches?: string[] }
const m = manifest as unknown as { web_accessible_resources?: unknown; host_permissions: string[]; content_scripts: ContentScript[] }

/** Chrome match-pattern semantics for the subset the manifest uses: `<scheme>://<host>/<path>`,
 *  where host is `*`, `*.domain` (domain and every subdomain) or an exact domain. */
function matchesPattern(pattern: string, url: URL): boolean {
	const parsed = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern)
	if (!parsed) throw new Error(`unsupported pattern ${pattern}`)
	const [, scheme, host, path] = parsed
	if (scheme !== "*" && `${scheme}:` !== url.protocol) return false
	const hostOk =
		host === "*" ||
		host === url.hostname ||
		(host.startsWith("*.") && (url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))))
	if (!hostOk) return false
	return path === "/*" || path === url.pathname || (path.endsWith("*") && url.pathname.startsWith(path.slice(0, -1)))
}
const injectsInto = (cs: ContentScript, href: string) => {
	const url = new URL(href)
	return cs.matches.some((p) => matchesPattern(p, url)) && !(cs.exclude_matches ?? []).some((p) => matchesPattern(p, url))
}

/**
 * The source manifest declares no web-accessible resources: the logo entry let every page fetch
 * it and so fingerprint the install, and the wallet-sdk discovery icon — the one asset a page
 * legitimately needs — travels inline instead. (The build plugin still emits entries for the
 * content-script chunks; that is a separate, tracked exposure.)
 */
describe("manifest surface", () => {
	test("declares no web-accessible resources", () => {
		expect(m.web_accessible_resources).toBeUndefined()
	})

	test("the discovery icon is a data URI, so no URL has to be exposed for it", () => {
		expect(logoDataUri.startsWith("data:image/png;base64,")).toBe(true)
	})
})

/**
 * The Relying Party host is a content-less subdomain: every origin whose registrable domain
 * suffix-matches the RP ID may run the passkey ceremony and evaluate the PRF the wallet master
 * derives from, so the apex and the application subdomains must not qualify, and no script —
 * the wallet's own content script included — may run on the RP host or its descendants.
 */
describe("passkey relying party", () => {
	test("the RP ID is the owner-selected content-less host", () => {
		expect(RP_ID).toBe("passkey.nulo.sh")
	})

	test("the host permission names exactly the RP host; the only other https origin is Presto's loopback", () => {
		expect(m.host_permissions).toContain(`https://${RP_ID}/`)
		const remote = m.host_permissions.filter((p) => p.startsWith("https://") && !p.startsWith("https://127.0.0.1/"))
		expect(remote).toEqual([`https://${RP_ID}/`])
		expect(m.host_permissions).toContain("https://127.0.0.1/*")
	})

	test("no in-repo deployable names the RP host (dashboard-managed hosting is out of this test's sight)", () => {
		const roots = ["apps/landing", "apps/tools"].map((r) => resolve(__dirname, "../../..", r))
		const skipped = (rel: string) => rel.split("/").some((seg) => seg === "node_modules" || seg === "dist" || seg.startsWith("."))
		const deployable = (rel: string) => /\.(jsonc?|toml|ts|vue|html)$/.test(rel) && !skipped(rel)
		const hits = roots.flatMap((root) =>
			(readdirSync(root, { recursive: true }) as string[])
				.filter(deployable)
				.map((rel) => join(root, rel))
				.filter((full) => statSync(full).isFile() && readFileSync(full, "utf8").includes(RP_ID)),
		)
		expect(hits).toEqual([])
	})

	test("the RP host is served by the content-less Worker, on that one name", () => {
		const config = readFileSync(resolve(__dirname, "../../../infra/passkey-rp/wrangler.jsonc"), "utf8")
		expect(JSON.parse(config.replace(/^\s*\/\/.*$/gm, "")).routes).toEqual([{ pattern: RP_ID, custom_domain: true }])
	})

	test("the content script never injects into the RP host or its descendants, and still does elsewhere", () => {
		const [cs] = m.content_scripts
		expect(injectsInto(cs, `https://${RP_ID}/`)).toBe(false)
		expect(injectsInto(cs, `https://${RP_ID}/index.html`)).toBe(false)
		expect(injectsInto(cs, `http://${RP_ID}/`)).toBe(false)
		expect(injectsInto(cs, `https://x.${RP_ID}/`)).toBe(false)
		expect(injectsInto(cs, "https://nulo.sh/")).toBe(true)
		expect(injectsInto(cs, "https://tools.nulo.sh/app")).toBe(true)
		expect(injectsInto(cs, "https://example.com/")).toBe(true)
	})
})

describe("firefox manifest", () => {
	const buildFirefox = () => {
		const build = firefoxManifest as unknown as (env: { command: string; mode: string }) => {
			permissions: string[]
			browser_specific_settings: {
				gecko: { id: string; strict_min_version: string; data_collection_permissions: { required: string[] } }
			}
		}
		return build({ command: "build", mode: "production" })
	}
	const buildGecko = () => buildFirefox().browser_specific_settings.gecko

	test("gecko id is well-formed and frozen — Firefox rejects the add-on as invalid otherwise", () => {
		const { id } = buildGecko()
		expect(id).toMatch(/^(\{[0-9a-f-]{36}\}|[a-z0-9._-]+@[a-z0-9._-]+)$/i)
		// The AMO identity of the add-on: changing it orphans every installed Firefox copy.
		expect(id).toBe("wallet@nulo.sh")
	})

	// Declaring collection the wallet does not do is a false public statement on the AMO listing;
	// "none" is only true while nothing is sent anywhere that identifies the user.
	test("declares no data collection", () => {
		expect(buildGecko().data_collection_permissions).toEqual({ required: ["none"] })
	})

	// Below 153 a passkey profile cannot be created: WebAuthn from an extension page needs 150+,
	// and 153 is the tested floor. Lowering this ships a flow that fails on the versions it admits.
	test("admits only Firefox 153 and newer", () => {
		expect(buildGecko().strict_min_version).toBe("153.0")
	})

	// AMO's validator rejects permissions Firefox does not implement, so anything Chrome-only has
	// to be filtered out of this build rather than left to be ignored at install.
	test("drops the permissions Firefox does not implement", () => {
		const { permissions } = buildFirefox()
		expect(permissions).not.toContain("sidePanel")
		expect(permissions).not.toContain("offscreen")
		expect(permissions).toContain("storage")
	})
})
