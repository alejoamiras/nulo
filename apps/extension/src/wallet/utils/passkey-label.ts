/**
 * Pure formatter for the WebAuthn `user.name` / `user.displayName` a passkey
 * registers under — i.e. the label iCloud Keychain / Google Password Manager /
 * 1Password show for the credential. NOT part of the key-derivation chain: the
 * master secret derives from the PRF output + `credentialId`, never from these
 * display fields, so this is purely cosmetic metadata.
 *
 * Kept WebAuthn-free (no DOM, no `navigator`) so the sanitization edge cases are
 * unit-testable in isolation.
 *
 * INVARIANT: only a normalized slug of the user's profile name ever leaves the
 * device (the authenticator syncs it into the user's iCloud/Google cloud). The
 * `[a-z0-9]` allow-list strips bidi/zero-width/control characters that could
 * otherwise spoof or confuse the credential label in the authenticator picker.
 */

/** Max length of the `{name}` slug portion. The profile-name input is itself
 *  capped at 32 chars (`useProfileNameField.ts`); this keeps the rendered
 *  authenticator label compact and only ever truncates 25–32-char names. */
const MAX_SLUG_LENGTH = 24

/**
 * Reduce a free-text profile name to a lowercase `[a-z0-9-]` slug.
 *
 * Pipeline: NFKD-decompose → drop combining marks → lowercase → collapse every
 * run of non-alphanumerics to a single `-` → trim edge hyphens → length-cap →
 * re-trim a hyphen the cap may have landed on. Stripping the combining marks
 * after NFKD is what turns `É` into `e` rather than the stray `e-` you'd get if
 * the decomposed accent were replaced by a hyphen.
 *
 * Returns `""` when nothing slugifiable remains (all-emoji, all-symbol, or
 * fully non-Latin names like CJK/Arabic) — the caller substitutes a name-free
 * fallback in that case.
 */
function slugify(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/g, "")
}

/**
 * Build the passkey credential label: `nulo-{slug}-{userHandle}`, or
 * `nulo-profile-{userHandle}` when the profile name has no slugifiable
 * characters. `userHandle` is the profile id (8 hex chars) and is used verbatim.
 */
export function formatPasskeyUserName(name: string, userHandle: string): string {
	const slug = slugify(name)
	return slug ? `nulo-${slug}-${userHandle}` : `nulo-profile-${userHandle}`
}
