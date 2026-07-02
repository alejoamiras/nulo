import { describe, expect, test } from "vitest"
import type { BackupSelection } from "@/utils/full-backup-helpers"
import { resolveFullBackupEnterAction } from "./import-helpers"

const sel = (o: Record<string, unknown>) => o as unknown as BackupSelection

describe("resolveFullBackupEnterAction (popup full-backup Enter shortcut)", () => {
	test("encrypted backup not yet decrypted → decrypt", () => {
		expect(
			resolveFullBackupEnterAction({
				selectedBackup: sel({ type: "encrypted", profileType: null }),
				restoreStatus: null,
				isRestoreHasErrors: false,
			}),
		).toBe("decrypt")
	})

	test("decrypted backup (has profileType), not finished → restore", () => {
		expect(
			resolveFullBackupEnterAction({
				selectedBackup: sel({ type: "encrypted", profileType: "password" }),
				restoreStatus: "",
				isRestoreHasErrors: false,
			}),
		).toBe("restore")
	})

	test("restore in progress → restore (still not finished)", () => {
		expect(
			resolveFullBackupEnterAction({
				selectedBackup: sel({ type: "plain", profileType: "passkey" }),
				restoreStatus: "progress",
				isRestoreHasErrors: false,
			}),
		).toBe("restore")
	})

	test("finished with errors → continue", () => {
		expect(
			resolveFullBackupEnterAction({
				selectedBackup: sel({ type: "plain", profileType: "password" }),
				restoreStatus: "finished",
				isRestoreHasErrors: true,
			}),
		).toBe("continue")
	})

	test("finished without errors → null (completeImport already ran)", () => {
		expect(
			resolveFullBackupEnterAction({
				selectedBackup: sel({ type: "plain", profileType: "password" }),
				restoreStatus: "finished",
				isRestoreHasErrors: false,
			}),
		).toBeNull()
	})

	test("nothing selected → null", () => {
		expect(resolveFullBackupEnterAction({ selectedBackup: null, restoreStatus: "", isRestoreHasErrors: false })).toBeNull()
	})
})
