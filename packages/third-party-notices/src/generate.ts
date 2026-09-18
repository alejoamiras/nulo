import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { BundleContents } from "./collect.ts"
import { type InstalledPackage, isThirdPartyPath, licenceFiles, modulePath, owningPackage } from "./packages.ts"
import type { Override, Policy, Vendored, VendoredComponent } from "./policy.ts"
import { isSpdxAllowed, parseSpdx } from "./spdx.ts"

export interface GenerateOptions {
	policy: Policy
	/** Directory holding the hand-verified texts that `Override.texts` and `VendoredComponent.texts` name. */
	textsDir: string
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

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const normalise = (text: string) => text.replace(/\r\n?/g, "\n").trimEnd()

function bundledPackages(moduleIds: readonly string[]): InstalledPackage[] {
	const found = new Map<string, InstalledPackage>()
	for (const id of moduleIds) {
		const path = modulePath(id)
		if (!path || !isThirdPartyPath(path)) continue
		const pkg = owningPackage(path)
		const key = `${pkg.name}@${pkg.version}`
		const known = found.get(key)
		// The isolated linker can install one name@version in several directories; pick one stably.
		if (!known || pkg.dir < known.dir) found.set(key, pkg)
	}
	return [...found.values()]
}

function licenceProblem(title: string, license: string, policy: Policy): string | undefined {
	try {
		if (isSpdxAllowed(parseSpdx(license), policy.allowed)) return undefined
		return `${title}: licence "${license}" is not allowed`
	} catch {
		return `${title}: licence "${license}" is not a valid SPDX expression`
	}
}

function readTexts(names: readonly string[], textsDir: string) {
	return names.map((name) => ({ label: name, body: normalise(readFileSync(join(textsDir, name), "utf8")) }))
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

function packageEntry(pkg: InstalledPackage, options: GenerateOptions, violations: string[]): Entry | undefined {
	const title = `${pkg.name}@${pkg.version}`
	const files = licenceFiles(pkg.dir)
	const override = options.policy.overrides.find((candidate) => candidate.names.includes(pkg.name))
	const before = violations.length
	if (override) violations.push(...overrideProblems(pkg, override, files.length > 0))
	const license = override?.license ?? pkg.license
	if (license === undefined) {
		violations.push(`${title}: no licence metadata and no OVERRIDES entry`)
		return undefined
	}
	if (!override && files.length === 0) violations.push(`${title}: ships no licence file and has no OVERRIDES entry`)
	const problem = licenceProblem(title, license, options.policy)
	if (problem) violations.push(problem)
	if (violations.length > before) return undefined
	const shipped = files.map((file) => ({ label: file, body: normalise(readFileSync(join(pkg.dir, file), "utf8")) }))
	const verified = readTexts(override?.texts ?? [], options.textsDir)
	return { title, license, source: override?.source, note: override?.note, texts: [...shipped, ...verified] }
}

function componentEntry(component: VendoredComponent, options: GenerateOptions, violations: string[]): Entry {
	const title = component.version ? `${component.name}@${component.version}` : component.name
	if (!/^https:\/\//.test(component.source)) violations.push(`${title}: VENDORED entry needs an https source URL`)
	if (component.texts.length === 0) violations.push(`${title}: VENDORED entry supplies no licence text`)
	const problem = licenceProblem(title, component.license, options.policy)
	if (problem) violations.push(problem)
	const { license, source, note } = component
	return { title, license, source, note, texts: readTexts(component.texts, options.textsDir) }
}

const describeTrigger = (vendored: Vendored) =>
	"package" in vendored.trigger ? `package ${vendored.trigger.package}` : `asset ${vendored.trigger.asset}`

function fires(vendored: Vendored, names: ReadonlySet<string>, assets: readonly string[]): boolean {
	const { trigger } = vendored
	return "package" in trigger ? names.has(trigger.package) : assets.some((asset) => trigger.asset.test(asset))
}

function vendoredEntries(contents: BundleContents, names: ReadonlySet<string>, options: GenerateOptions, violations: string[]): Entry[] {
	const entries: Entry[] = []
	for (const vendored of options.policy.vendored) {
		if (!fires(vendored, names, contents.assets)) {
			violations.push(`VENDORED entry for ${describeTrigger(vendored)} matched nothing; remove or fix it`)
			continue
		}
		for (const name of vendored.coveredBy ?? []) {
			if (!names.has(name)) violations.push(`${describeTrigger(vendored)} is covered by ${name}, which is not bundled`)
		}
		for (const component of vendored.components) entries.push(componentEntry(component, options, violations))
	}
	return entries
}

function unclaimedAssets(contents: BundleContents, policy: Policy): string[] {
	const claims = policy.vendored.flatMap(({ trigger }) => ("asset" in trigger ? [trigger.asset] : []))
	return contents.assets
		.filter((asset) => policy.binaryAsset.test(asset) && !claims.some((claim) => claim.test(asset)))
		.map((asset) => `${asset}: compiled asset with no VENDORED entry`)
}

function unusedOverrides(names: ReadonlySet<string>, policy: Policy): string[] {
	return policy.overrides
		.flatMap((override) => override.names)
		.filter((name) => !names.has(name))
		.map((name) => `${name}: OVERRIDES entry matches nothing bundled; remove it`)
}

function render(entries: readonly Entry[]): string {
	const blocks = [...entries]
		.sort((a, b) => byCodePoint(a.title, b.title))
		.map((entry) => {
			const head = [entry.title, `Licence: ${entry.license}`]
			if (entry.source) head.push(`Source: ${entry.source}`)
			if (entry.note) head.push(`Note: ${entry.note}`)
			const texts = entry.texts.map((text) => `${THIN_RULE}\n[${text.label}]\n\n${text.body}`)
			return [RULE, ...head, ...texts].join("\n")
		})
	return `${[HEADER, ...blocks].join("\n\n")}\n`
}

/**
 * The notices file for what a build ships. Byte-stable for a given input: entries sort by code
 * point and no path, timestamp or host detail is written.
 * @throws NoticesPolicyError listing every disallowed, missing, stale or unreviewed item by name.
 */
export function generateNotices(contents: BundleContents, options: GenerateOptions): string {
	const violations: string[] = []
	const packages = bundledPackages(contents.moduleIds)
	const names = new Set(packages.map((pkg) => pkg.name))
	const entries = packages.flatMap((pkg) => packageEntry(pkg, options, violations) ?? [])
	entries.push(...vendoredEntries(contents, names, options, violations))
	violations.push(...unclaimedAssets(contents, options.policy), ...unusedOverrides(names, options.policy))
	if (violations.length > 0) throw new NoticesPolicyError([...violations].sort(byCodePoint))
	return render(entries)
}

/** Component names listed in a rendered notices file, without versions. */
export function noticeNames(notices: string): Set<string> {
	const lines = notices.split("\n")
	const names = new Set<string>()
	lines.forEach((line, index) => {
		const title = line === RULE ? lines[index + 1] : undefined
		if (title) names.add(title.replace(/(?!^)@[^@]*$/, ""))
	})
	return names
}
