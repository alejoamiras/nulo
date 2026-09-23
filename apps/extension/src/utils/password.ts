export function isNewPasswordValid(password: string, repeated: string): boolean {
	return password.length >= 8 && password === repeated
}

/** Inline hint under a new-password pair, in the order the user resolves it. */
export function newPasswordHint(password: string, repeated: string): string {
	if (password.length < 8) return "At least 8 characters"
	if (password !== repeated) return "Passwords don't match"
	if (password.length > 24) return "Long enough. Don't forget it."
	return "Strong password"
}
