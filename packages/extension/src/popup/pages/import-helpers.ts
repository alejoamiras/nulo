import type { RestoreStatus } from "@/composables/useFullBackupImport"
import type { BackupSelection } from "@/utils/full-backup-helpers"

export type FullBackupEnterAction = "decrypt" | "restore" | "continue" | null

/**
 * Resolves which full-backup action an Enter keypress triggers, given the
 * current restore state — mirroring the popup import button layout: decrypt an
 * encrypted-but-not-yet-decrypted backup, restore a decrypted one, or continue
 * past a finished-with-errors restore. Popup-only (onboarding import has no
 * Enter shortcut). Extracted so the branching is unit-tested; the page keeps
 * only the trivial action→fn dispatch.
 */
export function resolveFullBackupEnterAction(state: {
	selectedBackup: BackupSelection | null
	restoreStatus: RestoreStatus
	isRestoreHasErrors: boolean
}): FullBackupEnterAction {
	const { selectedBackup, restoreStatus, isRestoreHasErrors } = state
	if (selectedBackup?.type === "encrypted" && !selectedBackup?.profileType) return "decrypt"
	if (selectedBackup?.profileType && restoreStatus !== "finished") return "restore"
	if (restoreStatus === "finished" && isRestoreHasErrors) return "continue"
	return null
}
