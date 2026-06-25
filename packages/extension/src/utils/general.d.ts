export function isPrefersDarkScheme(): boolean

export const THEME_HINT_KEY: string

export function persistThemeHint(value: string): void

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void

export function ensurePermissions(perms: chrome.permissions.Permissions): Promise<boolean>
