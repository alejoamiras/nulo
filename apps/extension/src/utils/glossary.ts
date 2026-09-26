/**
 * Every definition Nulo shows. Settings → Glossary renders all of them, and a dotted term takes a
 * key, never its own text, so a tooltip and the glossary cannot disagree.
 */
export type GlossaryEntry = {
	term: string
	definition: string
	/** Where the word appears, as the Glossary page lists it. */
	where: string
}

export const GLOSSARY = {
	"private-balance": {
		term: "Private balance",
		definition: "Only you can see it. Marked with a padlock.",
		where: "Home · tokens · send",
	},
	"public-balance": {
		term: "Public balance",
		definition: "Anyone can see it, like a balance on Ethereum. Marked with a globe.",
		where: "Home · tokens · send",
	},
	"fee-juice": {
		term: "Fee Juice",
		definition: "The token that pays network fees on Aztec. Shown as FJ.",
		where: "Home · fee card",
	},
	"public-fee-juice": {
		term: "Public Fee Juice",
		definition: "Paying a fee with it shows your address.",
		where: "Home · fee menu",
	},
	"private-fee-juice": {
		term: "Private Fee Juice",
		definition: "Paying a fee with it keeps your address hidden.",
		where: "Home · fee menu",
	},
	sponsored: {
		term: "Sponsored",
		definition: "Someone else pays the network fee for you.",
		where: "Fee menu",
	},
	authorization: {
		term: "Authorization",
		definition: "Lets a contract do one specific thing for you, once.",
		where: "Permission window · approval window",
	},
	"name-for-this-app": {
		term: "Name for this app",
		definition: "A private name for this account visible only to this app.",
		where: "Permission window",
	},
	proving: {
		term: "Proving",
		definition:
			"Your device builds a proof that the transaction is valid without revealing what's in it. It's the slow step before sending.",
		where: "History · Settings",
	},
} as const satisfies Record<string, GlossaryEntry>

export type GlossaryKey = keyof typeof GLOSSARY

export const GLOSSARY_SECTIONS = [
	{ title: "Balances", keys: ["private-balance", "public-balance"] },
	{ title: "Fees", keys: ["fee-juice", "public-fee-juice", "private-fee-juice", "sponsored"] },
	{ title: "Apps", keys: ["authorization", "name-for-this-app"] },
	{ title: "Transactions", keys: ["proving"] },
] as const satisfies ReadonlyArray<{ title: string; keys: ReadonlyArray<GlossaryKey> }>
