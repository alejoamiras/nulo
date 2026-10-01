/**
 * The per-profile UI keys in `chrome.storage.local`. Deleting a profile removes
 * `profileUiKeys(id)`, so a per-profile key defined anywhere else outlives its profile.
 */

const PINNED_TOKENS_PREFIX = "nulo:ui:pinnedTokens@"

/** Each prefix ends in `@`, so a key is its prefix followed by one whole profile id. */
export const PROFILE_UI_KEY_PREFIXES: readonly string[] = [PINNED_TOKENS_PREFIX]

/** Per-profile map of chain id → pinned token contracts; a UI preference, never backed up. */
export const pinnedTokensKey = (profileId: string) => `${PINNED_TOKENS_PREFIX}${profileId}`

/** The exact keys `profileId` can hold: `p1`'s never include `p10`'s. */
export const profileUiKeys = (profileId: string): string[] => PROFILE_UI_KEY_PREFIXES.map((prefix) => `${prefix}${profileId}`)
