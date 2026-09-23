import type { ZodType } from "zod"

export type RawRowState<T> = { kind: "absent" } | { kind: "corrupt" } | { kind: "valid"; value: T }

/** Decode one raw storage value without ever removing it: a row that exists but does not decode is
 *  `corrupt`, never `absent` — the fail-closed repositories key their behaviour on that difference. */
export function decodeRow<T>(schema: ZodType<T>, raw: unknown): RawRowState<T> {
	if (raw === undefined) return { kind: "absent" }
	if (typeof raw === "string") {
		try {
			const parsed = schema.safeParse(JSON.parse(raw))
			if (parsed.success) return { kind: "valid", value: parsed.data }
		} catch {
			// unparseable JSON — corrupt
		}
	}
	return { kind: "corrupt" }
}
