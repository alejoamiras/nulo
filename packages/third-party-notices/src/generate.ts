import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { BundleContents } from "./collect.ts"
import { type InstalledPackage, licenceFiles, moduleOrigin, modulePath, type NamedManifest, owningPackage } from "./packages.ts"
import type { Override, Policy, Vendored, VendoredComponent } from "./policy.ts"
import { isSpdxAllowed, parseSpdx } from "./spdx.ts"

export interface GenerateOptions {
	policy: Policy
	/** Directory holding the hand-verified texts that `Override.texts` and `VendoredComponent.texts` name. */
	textsDir: string
	/** The repository root: only files under it, outside every `node_modules`, are first-party. */
	workspaceRoot: string
}

interface Entry {
	title: string
	license: string
	source?: string
	note?: string
	texts: { label: string; body: string }[]
}

/** Every policy failure of one build, reported together so a bump is fixed in one pass. */
export class NoticesPolicyError extends Error {
	readonly violations: readonly string[]

	// No parameter property: the Vite config loads this file through Node's type stripping.
	constructor(violations: readonly string[]) {
		super(`third-party notices refused:\n${violations.map((line) => `  - ${line}`).join("\n")}`)
		this.name = "NoticesPolicyError"
		this.violations = violations
	}
}

const RULE = "=".repeat(80)
const THIN_RULE = "-".repeat(80)
const HEADER = [
	"THIRD-PARTY NOTICES",
	"",
	"Nulo includes the open-source software listed below. Each entry names the component, the",
	"licence it is distributed under, and reproduces the licence text that comes with it.",
].join("\n")
const INVENTORY_START = "COMPONENTS"

/** Vite inlines such a worker as a string in the importing chunk, so its modules appear in no bundle. */
const INLINE_WORKER = /[?&](?:shared)?worker\b.*[?&]inline\b|[?&]inline\b.*[?&](?:shared)?worker\b/

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const normalise = (text: string) => text.replace(/\r\n?/g, "\n").trimEnd()

/** Every distinct installation that rendered code; one name@version can be installed more than once. */
function bundledPackages(moduleIds: readonly string[], workspaceRoot: string, violations: string[]): InstalledPackage[] {
	const found = new Map<string, InstalledPackage>()
	for (const id of moduleIds) {
		if (INLINE_WORKER.test(id))
			violations.push(`${id.split("/").at(-1)}: an inline worker ships inside its importer, where no worker build records it`)
		const path = modulePath(id)
		if (!path) continue
		const origin = moduleOrigin(path, workspaceRoot)
		if (origin === "external")
			violations.push(`${path.split("/").slice(-2).join("/")}: bundled from outside the workspace and outside node_modules`)
		if (origin !== "third-party") continue
		const pkg = owningPackage(path)
		found.set(`${pkg.dir}\0${JSON.stringify(pkg.nested)}`, pkg)
	}
	return [...found.values()].sort((a, b) => byCodePoint(a.dir, b.dir))
}

function licenceProblem(title: string, license: string, allowed: ReadonlySet<string>): string | undefined {
	try {
		if (isSpdxAllowed(parseSpdx(license), allowed)) return undefined
		return `${title}: licence "${license}" is not allowed`
	} catch {
		return `${title}: licence "${license}" is not a valid SPDX expression`
	}
}

function readTexts(names: readonly string[], textsDir: string, violations: string[]) {
	return names.map((name) => {
		const body = normalise(readFileSync(join(textsDir, name), "utf8"))
		if (body.trim() === "") violations.push(`texts/${name}: reviewed licence text is empty`)
		return { label: name, body }
	})
}

function overrideProblems(pkg: InstalledPackage, override: Override, shipsFile: boolean): string[] {
	const title = `${pkg.name}@${pkg.version}`
	const problems: string[] = []
	if (override.reviewedVersion !== pkg.version) {
		problems.push(`${title}: OVERRIDES entry was reviewed at ${override.reviewedVersion}; re-verify it for this version`)
	}
	if (pkg.license !== undefined && shipsFile) {
		problems.push(`${title}: now ships licence metadata and a licence file; remove its stale OVERRIDES entry`)
	}
	if (pkg.license !== undefined && pkg.license !== override.license && pkg.license !== override.declared) {
		problems.push(`${title}: declares "${pkg.license}", which its OVERRIDES entry does not acknowledge`)
	}
	if (!shipsFile && !override.texts?.length) {
		problems.push(`${title}: ships no licence file and its OVERRIDES entry supplies no text`)
	}
	if (!/^https:\/\//.test(override.source)) problems.push(`${title}: OVERRIDES entry needs an https source URL`)
	return problems
}

/** A reviewed record for a foreign package found inside `host`: same name, same version, same licence. */
function isReviewedEmbed(host: InstalledPackage, nested: NamedManifest, policy: Policy): boolean {
	return policy.vendored.some(
		({ trigger, components }) =>
			"package" in trigger &&
			trigger.package === host.name &&
			components.some(
				(component) =>
					component.name === nested.name &&
					component.version === nested.version &&
					(nested.license === undefined || nested.license === component.license),
			),
	)
}

/** Holds every manifest found below the installation root against the root, or against a reviewed record. */
function nestedProblems(pkg: InstalledPackage, policy: Policy): string[] {
	const title = `${pkg.name}@${pkg.version}`
	return pkg.nested.flatMap((nested) => {
		const found = `${nested.name}@${nested.version}`
		if (nested.incomplete)
			return [`${title}: carries a nested manifest that states a name, version or licence without identifying a package`]
		if (nested.malformedLicence) return [`${title}: nested manifest ${found} declares a licence that cannot be read`]
		if (nested.name !== pkg.name) {
			return isReviewedEmbed(pkg, nested, policy)
				? []
				: [`${title}: embeds ${found}, which has no matching VENDORED component record`]
		}
		const agrees = nested.version === pkg.version && (nested.license === undefined || nested.license === pkg.license)
		return agrees
			? []
			: [
					`${title}: carries a nested manifest (${found}, ${nested.license ?? "no licence"}) that disagrees with its installation root`,
				]
	})
}

function packageEntry(pkg: InstalledPackage, options: GenerateOptions, violations: string[]): Entry | undefined {
	const title = `${pkg.name}@${pkg.version}`
	const files = licenceFiles(pkg.dir)
	const shipsLicence = files.licences.length > 0
	const override = options.policy.overrides.find((candidate) => candidate.names.includes(pkg.name))
	const before = violations.length
	if (override) violations.push(...overrideProblems(pkg, override, shipsLicence))
	violations.push(...nestedProblems(pkg, options.policy))
	if (pkg.malformedLicence) violations.push(`${title}: declares a licence that cannot be read; an OVERRIDES entry cannot stand in for it`)
	const license = override?.license ?? pkg.license
	if (license === undefined) {
		if (!pkg.malformedLicence) violations.push(`${title}: no licence metadata and no OVERRIDES entry`)
		return undefined
	}
	if (!override && !shipsLicence) violations.push(`${title}: ships no licence file and has no OVERRIDES entry`)
	const problem = licenceProblem(title, license, options.policy.allowed)
	if (problem) violations.push(problem)
	if (violations.length > before) return undefined
	const shipped = [...files.licences, ...files.notices].map((file) => ({
		label: file,
		body: normalise(readFileSync(join(pkg.dir, file), "utf8")),
	}))
	const verified = readTexts(override?.texts ?? [], options.textsDir, violations)
	return { title, license, source: override?.source, note: override?.note, texts: [...shipped, ...verified] }
}

/** Two installations of one name@version are one entry only when they would print identically. */
function mergeInstallations(entries: readonly Entry[], violations: string[]): Entry[] {
	const merged = new Map<string, Entry>()
	for (const entry of entries) {
		const known = merged.get(entry.title)
		if (!known) merged.set(entry.title, entry)
		else if (JSON.stringify(known) !== JSON.stringify(entry)) {
			violations.push(`${entry.title}: installed more than once with differing licence content`)
		}
	}
	return [...merged.values()]
}

function componentEntry(component: VendoredComponent, allowed: ReadonlySet<string>, options: GenerateOptions, violations: string[]): Entry {
	const title = component.version ? `${component.name}@${component.version}` : component.name
	if (!/^https:\/\//.test(component.source)) violations.push(`${title}: VENDORED entry needs an https source URL`)
	if (component.texts.length === 0) violations.push(`${title}: VENDORED entry supplies no licence text`)
	const problem = licenceProblem(title, component.license, allowed)
	if (problem) violations.push(problem)
	const { license, source, note } = component
	return { title, license, source, note, texts: readTexts(component.texts, options.textsDir, violations) }
}

const describeTrigger = (vendored: Vendored) =>
	"package" in vendored.trigger ? `package ${vendored.trigger.package}` : `asset ${vendored.trigger.asset}`

function triggerProblem(vendored: Vendored, packages: readonly InstalledPackage[], contents: BundleContents) {
	const { trigger, generated } = vendored
	if ("asset" in trigger) {
		const matched = contents.assets.filter((asset) => trigger.asset.test(asset))
		if (matched.length === 0) return "matched nothing; remove or fix it"
		const foreign = generated && matched.find((asset) => !generated.content.test(contents.assetText[asset] ?? ""))
		if (foreign) return `claims ${foreign}, whose content is not what ${generated.by} writes`
		const reviewed = vendored.font?.sha256
		const replaced = reviewed && matched.find((asset) => !reviewed.includes(contents.assetSha256[asset] ?? ""))
		return replaced ? `claims ${replaced}, whose bytes are not a reviewed font file; re-check its licence and provenance` : undefined
	}
	const hosts = packages.filter((pkg) => pkg.name === trigger.package)
	if (hosts.length === 0) return "matched nothing; remove or fix it"
	const drifted = hosts.find((pkg) => pkg.version !== trigger.reviewedVersion)
	return drifted ? `was reviewed at ${trigger.reviewedVersion}, not ${drifted.version}; re-inspect what it embeds` : undefined
}

function accountingProblems(vendored: Vendored, bundled: ReadonlySet<string>): string[] {
	const accounted = vendored.components.length > 0 || vendored.coveredBy?.length || vendored.generated
	const missing = (vendored.coveredBy ?? []).filter((name) => !bundled.has(name))
	return [
		...(accounted ? [] : ["names no component, no covering package and no generator"]),
		...missing.map((name) => `is covered by ${name}, which is not bundled`),
	]
}

function vendoredEntries(
	contents: BundleContents,
	packages: readonly InstalledPackage[],
	options: GenerateOptions,
	violations: string[],
): Entry[] {
	const names = new Set(packages.map((pkg) => pkg.name))
	const entries: Entry[] = []
	for (const vendored of options.policy.vendored) {
		const label = `VENDORED entry for ${describeTrigger(vendored)}`
		const problem = triggerProblem(vendored, packages, contents)
		if (problem) {
			violations.push(`${label} ${problem}`)
			continue
		}
		violations.push(...accountingProblems(vendored, names).map((problem) => `${label} ${problem}`))
		const allowed = vendored.font ? options.policy.fontAllowed : options.policy.allowed
		for (const component of vendored.components) entries.push(componentEntry(component, allowed, options, violations))
	}
	return entries
}

function unclaimedAssets(contents: BundleContents, policy: Policy): string[] {
	const claims = policy.vendored.flatMap(({ trigger }) => ("asset" in trigger ? [trigger.asset] : []))
	const built = new Set(contents.builtAssets)
	return contents.assets
		.filter((asset) => policy.codeAsset.test(asset) && !built.has(asset) && !claims.some((claim) => claim.test(asset)))
		.map((asset) => `${asset}: emitted code or font asset with no VENDORED entry`)
}

function unusedOverrides(names: ReadonlySet<string>, policy: Policy): string[] {
	return policy.overrides
		.flatMap((override) => override.names)
		.filter((name) => !names.has(name))
		.map((name) => `${name}: OVERRIDES entry matches nothing bundled; remove it`)
}

function render(entries: readonly Entry[]): string {
	const sorted = [...entries].sort((a, b) => byCodePoint(a.title, b.title))
	// The inventory precedes every licence text, so no text can forge or hide a line of it.
	const inventory = [`${INVENTORY_START} (${sorted.length})`, ...sorted.map((entry) => `${entry.title}\t${entry.license}`)]
	const blocks = sorted.map((entry) => {
		const head = [entry.title, `Licence: ${entry.license}`]
		if (entry.source) head.push(`Source: ${entry.source}`)
		if (entry.note) head.push(`Note: ${entry.note}`)
		const texts = entry.texts.map((text) => `${THIN_RULE}\n[${text.label}]\n\n${text.body}`)
		return [RULE, ...head, ...texts].join("\n")
	})
	return `${[HEADER, inventory.join("\n"), ...blocks].join("\n\n")}\n`
}

/**
 * The notices file for what a build ships. Byte-stable for a given input: entries sort by code
 * point and no path, timestamp or host detail is written.
 * @throws NoticesPolicyError listing every disallowed, missing, stale or unreviewed item by name.
 */
export function generateNotices(contents: BundleContents, options: GenerateOptions): string {
	const violations: string[] = []
	const packages = bundledPackages(contents.moduleIds, options.workspaceRoot, violations)
	const names = new Set(packages.map((pkg) => pkg.name))
	const installed = packages.flatMap((pkg) => packageEntry(pkg, options, violations) ?? [])
	const entries = mergeInstallations(installed, violations)
	entries.push(...vendoredEntries(contents, packages, options, violations))
	violations.push(...unclaimedAssets(contents, options.policy), ...unusedOverrides(names, options.policy))
	for (const style of contents.unfollowedStyles ?? [])
		violations.push(`${style}: stylesheet import could not be followed, so what it inlines cannot be attributed`)
	if (violations.length > 0) throw new NoticesPolicyError([...new Set(violations)].sort(byCodePoint))
	return render(entries)
}

/**
 * Component names listed in a rendered notices file, without versions. Reads only the inventory,
 * at the fixed position the renderer puts it, above all third-party text.
 * @throws when the inventory is not there or its row count is not the one it states.
 */
export function noticeNames(notices: string): Set<string> {
	const lines = notices.split("\n")
	const start = HEADER.split("\n").length + 1
	const stated = /^COMPONENTS \((\d+)\)$/.exec(lines[start] ?? "")
	if (!notices.startsWith(`${HEADER}\n\n`) || !stated) throw new Error("notices file does not open with the component inventory")
	const end = lines.indexOf("", start)
	const rows = lines.slice(start + 1, end === -1 ? undefined : end)
	if (rows.length !== Number(stated[1])) throw new Error(`inventory states ${stated[1]} components and lists ${rows.length}`)
	return new Set(rows.map((row) => (row.split("\t")[0] ?? "").replace(/(?!^)@[^@]*$/, "")))
}
