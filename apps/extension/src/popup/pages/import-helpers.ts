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
	// Never resolve to "restore" while a restore is already in flight — the
	// composable guards re-entry too, but not firing the action keeps Enter
	// from queueing a redundant submit mid-import.
	if (selectedBackup?.profileType && restoreStatus !== "finished" && restoreStatus !== "progress") return "restore"
	if (restoreStatus === "finished" && isRestoreHasErrors) return "continue"
	return null
}
