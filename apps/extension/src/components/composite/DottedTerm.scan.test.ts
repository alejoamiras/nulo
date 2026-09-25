import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { GLOSSARY } from "@/utils/glossary"

/**
 * A dotted term's definition is whatever its key names, so the keys are the contract. Textual on
 * purpose: every `<DottedTerm` must name its key literally, and anything this scan cannot read
 * fails instead of being skipped.
 */

const SRC = resolve(__dirname, "../..")

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return walk(path)
		return entry.name.endsWith(".vue") ? [path] : []
	})
}

const occurrences = walk(SRC).flatMap((path) =>
	[...readFileSync(path, "utf8").matchAll(/<DottedTerm\b([^>]*)>/g)].map((match) => ({
		where: relative(SRC, path),
		attrs: match[1] ?? "",
	})),
)

const keyOf = (attrs: string) => /(?:^|\s)term="([^"]*)"/.exec(attrs)?.[1]
const isBound = (attrs: string) => /(?:^|\s)(?::|v-bind:)term\b/.test(attrs)

describe("dotted terms", () => {
	test("the scan finds the terms that exist", () => {
		expect(occurrences.length).toBeGreaterThan(0)
	})

	test("every dotted term names an existing glossary key, literally", () => {
		const offenders = occurrences.flatMap(({ where, attrs }) => {
			if (isBound(attrs)) return [`${where}: bound term`]
			const key = keyOf(attrs)
			if (key === undefined) return [`${where}: no term`]
			return Object.hasOwn(GLOSSARY, key) ? [] : [`${where}: unknown key "${key}"`]
		})
		expect(offenders).toEqual([])
	})

	test("every definition a dotted term shows is one sentence of at most 100 characters", () => {
		const used = new Set(
			occurrences.map(({ attrs }) => keyOf(attrs)).filter((key) => key !== undefined && Object.hasOwn(GLOSSARY, key)),
		)
		const tooLong = [...used].flatMap((key) => {
			const { definition } = GLOSSARY[key as keyof typeof GLOSSARY]
			const sentences = definition.split(/(?<=[.!?])\s+/).length
			return definition.length <= 100 && sentences === 1 ? [] : [`${key}: ${sentences} sentences, ${definition.length} chars`]
		})
		expect(tooLong).toEqual([])
	})
})
