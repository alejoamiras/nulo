export const FIRST_PROFILE_NAME = "Main"

/**
 * The form under which two profile names collide. NFKC + locale lower-case folds stylistic
 * variants ("ﬂ"/"fl", "K"/"K"); it does not fold cross-script homoglyphs (Cyrillic "А").
 */
export function normalizeProfileName(name: string): string {
	return name.normalize("NFKC").toLocaleLowerCase()
}

/**
 * The automatic name for a new profile: "Main" when there is none yet, otherwise `Profile ${n}`
 * with n = profiles + 1, bumped past any name it collides with. Always 1–32 characters and
 * unique under `normalizeProfileName`, so it passes the name field's own validation.
 */
export function defaultProfileName(existing: readonly string[]): string {
	if (existing.length === 0) return FIRST_PROFILE_NAME
	const taken = new Set(existing.map(normalizeProfileName))
	let n = existing.length + 1
	while (taken.has(normalizeProfileName(`Profile ${n}`))) n++
	return `Profile ${n}`
}
