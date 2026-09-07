/** Chrome storage keys used by the popup UI layer. */
export const UI_STORAGE_KEYS = {
	FEE_PAYMENT_METHODS: "nulo:ui:feePaymentMethods",
} as const

/** Per-profile map of chain id → pinned token contracts; a UI preference, never backed up. */
export const pinnedTokensKey = (profileId: string) => `nulo:ui:pinnedTokens@${profileId}`
