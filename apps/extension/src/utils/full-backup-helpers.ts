/**
 * Pure helpers for import.vue / useFullBackupImport.
 * No vue, no chrome.*, no service clients — safe to import anywhere.
 */

import { fromBase64 } from "@/wallet/utils"

export type BackupFileType = "plain" | "encrypted" | "unknown"

export interface BackupSelection {
	name: string
	backup: unknown
	type: BackupFileType
	profileType: string | null
}

export function detectBackupType(text: string): BackupFileType {
	const trimmed = text.trim()
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "plain"
	try {
		const bytes = fromBase64(trimmed)
		if (bytes.length >= 13 && bytes[0] === 0) return "encrypted"
	} catch {
		return "unknown"
	}
	return "unknown"
}

export interface ProcessBackupResult {
	selection: BackupSelection
	parseError?: { title: string; tooltip: string }
}

export async function readBackupFile(file: File): Promise<ProcessBackupResult> {
	const text = await file.text()
	const detectedType = detectBackupType(text)
	let backup: unknown = null
	let profileType: string | null = null
	let parseError: ProcessBackupResult["parseError"] | undefined

	if (detectedType === "plain") {
		try {
			backup = JSON.parse(text)
			profileType = (backup as { data?: { profile?: { type?: string } } })?.data?.profile?.type ?? null
		} catch {
			parseError = {
				title: "Invalid JSON Format",
				tooltip: "The selected file is not a valid JSON backup. Please select a correct backup file.",
			}
		}
	} else {
		backup = text
	}

	return {
		selection: { name: file.name, backup, type: detectedType, profileType },
		parseError,
	}
}

interface AccountStateRestoreItem {
	networkId: string
	contracts: Array<{ restoreError?: unknown } & Record<string, unknown>>
	senders: Array<{ restoreError?: unknown } & Record<string, unknown>>
}

interface GenericRestoreItem {
	restoreError?: unknown
}

/**
 * Filter restored data for items with `restoreError`. Returns `null` when
 * there are no errors to record (caller should skip writing to log).
 */
export function collectRestoreErrors(serviceName: string, data: unknown): unknown[] | null {
	if (!Array.isArray(data) || !data.length || !serviceName) return null
	if (serviceName === "account-state") {
		const out: AccountStateRestoreItem[] = []
		for (const item of data as AccountStateRestoreItem[]) {
			const failedContracts = item.contracts.filter((c) => c.restoreError)
			const failedSenders = item.senders.filter((s) => s.restoreError)
			if (!failedContracts.length && !failedSenders.length) continue
			out.push({ networkId: item.networkId, contracts: failedContracts, senders: failedSenders })
		}
		return out.length ? out : null
	}
	const filtered = (data as GenericRestoreItem[]).filter((item) => item.restoreError)
	return filtered.length ? filtered : null
}

/**
 * Rewrite all `*.{idKey}` references inside `backup.data` from `oldId` →
 * `newId`. Used after profile/network restore returns a different id than
 * the source backup so child rows still link to the new parent.
 */
export function remapIdInBackupData(data: Record<string, unknown>, idKey: string, newId: string): void {
	for (const key of Object.keys(data)) {
		const value = data[key]
		if (Array.isArray(value)) {
			data[key] = value.map((item) => {
				if (item && typeof item === "object" && idKey in item) {
					return { ...(item as Record<string, unknown>), [idKey]: newId }
				}
				return item
			})
		}
	}
}
