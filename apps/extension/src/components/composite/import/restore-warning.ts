export function restoreWarningText(networkNames: readonly string[], hasOtherErrors: boolean): string {
	if (networkNames.length === 0) return "Profile import completed with some errors. You can review the details or continue."
	const pronoun = networkNames.length === 1 ? "it" : "them"
	const choices = hasOtherErrors ? "You can retry, review the details, or continue." : "You can retry or continue."
	return `${joinNames(networkNames)} didn't answer in time, so what was saved for ${pronoun} may not be restored. ${choices}`
}

function joinNames(names: readonly string[]): string {
	if (names.length <= 2) return names.join(" and ")
	return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}
