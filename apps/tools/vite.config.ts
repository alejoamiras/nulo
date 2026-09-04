import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig, type Plugin, type UserConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { nuloComponentsPlugin } from "./scripts/components-plugin"
import { type ToolsTarget, TESTNET_TARGET } from "./src/lib/network-targets"
import { deriveAllowedPreviewHosts } from "./src/lib/preview-hosts"

const COOP_COEP_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
}

// Dev server port. Defaults to 5176 for local DX; the e2e network harness
// overrides this per-worktree via TOOLS_DEV_PORT so parallel agents don't
// collide. strictPort is only on for local dev — when the harness picks a
// port, Vite must be allowed to bind to whatever it allocates.
const TOOLS_DEV_PORT = Number(process.env.TOOLS_DEV_PORT) || 5176

/**
 * Emit authoritative build metadata so the release pipeline's post-deploy
 * `verify-live` check can prove WHAT is actually live (and catch a split CDN
 * cache serving a fresh build.json over a stale index.html). One `buildId` goes
 * into BOTH the served HTML (`<meta name="nulo-build">`) and `dist/build.json`;
 * verify-live requires them to match EXACTLY. `chainId` is the target's canonical
 * wallet id (single-sourced from the ToolsTarget) — verify-live asserts the live
 * tools app serves the chain the wallet expects, and `target`/`manifestDigest` let
 * CI prove the right per-target manifest shipped.
 */
function buildMetaPlugin(target: ToolsTarget, manifestJson: string, allowedPreviewHosts: readonly string[] = []): Plugin {
	const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string }
	let buildId = ""
	let root = process.cwd()
	let outDir = "dist"
	return {
		name: "nulo-build-meta",
		apply: "build",
		configResolved(config) {
			root = config.root
			outDir = config.build.outDir
			// Prefer Cloudflare's commit SHA, then local git, then a timestamp.
			const sha =
				process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8) ??
				(() => {
					try {
						return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
							.toString()
							.trim()
					} catch {
						return null
					}
				})() ??
				`t${Date.now()}`
			buildId = `${pkg.version}+${sha}`
		},
		transformIndexHtml() {
			return [{ tag: "meta", attrs: { name: "nulo-build", content: buildId }, injectTo: "head" }]
		},
		closeBundle() {
			// manifestDigest lets CI (verify-deployments) compare the digest EMITTED here against the
			// bundled manifest — not a recomputed one (codex round-3).
			const manifestDigest = createHashHex(manifestJson)
			const meta = {
				buildId,
				version: pkg.version,
				target: target.key,
				chainId: target.walletChainId,
				manifestDigest,
				...(allowedPreviewHosts.length > 0 ? { allowedPreviewHosts } : {}),
			}
			writeFileSync(resolve(root, outDir, "build.json"), `${JSON.stringify(meta, null, 2)}\n`)
			// The active manifest is inlined into the bundle at build; the OTHER target's raw JSON must
			// not ship (no placeholder mainnet manifest served on the testnet site, and vice-versa).
			for (const f of readdirSync(resolve(root, outDir))) {
				if (f.endsWith("-bridge.json") && f !== target.manifestFile) rmSync(resolve(root, outDir, f))
			}
		},
	}
}

/** sha256 of the exact bundled manifest bytes, hex — the identity CI checks against. */
function createHashHex(s: string): string {
	return createHash("sha256").update(s).digest("hex")
}

function readManifest(target: ToolsTarget): string {
	const p = fileURLToPath(new URL(`./public/${target.manifestFile}`, import.meta.url))
	return readFileSync(p, "utf8")
}

/**
 * Write `dist/_headers` (Cloudflare Pages) with the TARGET's CSP `connect-src` — testnet allows the
 * Aztec node hosts plus `tokens.uniswap.org`, while the mainnet placeholder talks to nothing remote
 * at all. Generated per build rather than shipped statically so the two deployments can't share one
 * header set, which would hand the placeholder origins it must never be able to reach.
 */
function headersPlugin(target: ToolsTarget): Plugin {
	let root = process.cwd()
	let outDir = "dist"
	const csp = [
		"default-src 'self'",
		"img-src 'self' data:",
		"font-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"worker-src 'self' blob:",
		`connect-src ${target.cspConnectSrc}`,
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
	].join("; ")
	const body = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`
	return {
		name: "nulo-headers",
		apply: "build",
		configResolved(config) {
			root = config.root
			outDir = config.build.outDir
		},
		closeBundle() {
			writeFileSync(resolve(root, outDir, "_headers"), body)
		},
	}
}

/**
 * The config factory. Each `vite.<target>.config.mts` calls this with its one `ToolsTarget`; the
 * default export builds testnet so the legacy `vite build` (and vitest, which ignores this file) keep
 * working. The target key + its bridge manifest are `define`d into `import.meta.env` so the app
 * (`resolveToolsTarget`, `bridge-generation`) reads them at runtime; `build.json` gets the target
 * via the plugin arg (Node scope — a vite alias can't reach here).
 */
export function makeToolsConfig(target: ToolsTarget): UserConfig {
	const manifestJson = readManifest(target)
	// Cloudflare Pages PR previews: a preview is a PROD build served at TWO hostnames — the
	// per-commit <hash>.<project>.pages.dev (CF_PAGES_URL) AND the branch alias. Both are baked
	// as EXACT strings (never a *.pages.dev wildcard — codex bug-bash r1), and ONLY for testnet
	// builds of a non-production branch: mainnet artifacts never accept an alternate host.
	const allowedPreviewHosts = deriveAllowedPreviewHosts({
		targetKey: target.key,
		cfPagesUrl: process.env.CF_PAGES_URL,
		cfBranch: process.env.CF_PAGES_BRANCH,
	})
	return defineConfig({
		server: {
			port: TOOLS_DEV_PORT,
			strictPort: !process.env.TOOLS_DEV_PORT,
			// bb.js threaded wasm requires cross-origin isolation. Same headers
			// ship in production via public/_headers (Cloudflare Pages).
			headers: COOP_COEP_HEADERS,
		},
		preview: {
			headers: COOP_COEP_HEADERS,
		},
		define: {
			"import.meta.env.VITE_TOOLS_TARGET": JSON.stringify(target.key),
			"import.meta.env.VITE_BRIDGE_MANIFEST_JSON": JSON.stringify(manifestJson),
			"import.meta.env.VITE_ALLOWED_PREVIEW_HOSTS": JSON.stringify(allowedPreviewHosts.join(",")),
		},
		resolve: {
			alias: [
				{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
				// nodePolyfills' `globals.Buffer` injects an import of this shim into EVERY
				// transformed module, which rolldown then resolves from that module's own
				// location. Workspace packages (wallet-crypto, wallet-core) don't declare the
				// plugin, so under the isolated linker the bare specifier is unreachable from
				// them — pin it to this app's copy. Same shape as apps/extension/vite.config.ts.
				{
					find: "vite-plugin-node-polyfills/shims/buffer",
					replacement: resolvePackageAsset("vite-plugin-node-polyfills", "shims/buffer/dist/index.js", {
						from: import.meta.url,
					}),
				},
			],
			// Multiple nested versions of these WASM-binding packages can exist
			// in node_modules. Without dedup, initAbi() and abiEncode() end up
			// in different module scopes and the WASM instance never resolves.
			// Same shape as apps/extension/vite.config.ts:108.
			dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
		},
		plugins: [
			vue(),
			nuloComponentsPlugin({ dts: "src/types/components.d.ts" }),
			nodePolyfills({
				// Aztec packages reach for `process` at module top-level via util/path
				// shims. Without these the bundle throws ReferenceError before mount.
				globals: { Buffer: true, global: true, process: true },
			}),
			buildMetaPlugin(target, manifestJson, allowedPreviewHosts),
			headersPlugin(target),
		],
	})
}

export default makeToolsConfig(TESTNET_TARGET)
