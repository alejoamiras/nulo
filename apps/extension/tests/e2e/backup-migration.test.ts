/**
 * Backup-import migration smoke: drives a PRE-shape (v1) full backup through
 * the REAL import UI and asserts the build-stamped declarative backup fixture
 * (`src/e2e/backup-migration-fixture.ts`, v9001: contact `legacyName` → `name`)
 * migrated the slices in-memory BEFORE the restore pipeline wrote them —
 * `chrome.storage.local` must hold CURRENT-shape rows.
 *
 * Fixture arming mirrors `migration.test.ts`: the build carries the fixture
 * only when stamped with `VITE_NULO_E2E_MIGRATION_FIXTURE=1`, and the runner
 * declares that via `NULO_E2E_MIGRATION_FIXTURE=1`. The ONLY legitimate
 * unarmed run is the release-artifact smoke path (prod zips exclude fixtures
 * by design) — anywhere else, an unarmed run FAILS the contract test below
 * instead of silently skipping (a skipped fixture e2e is a false green).
 */
import { expect } from "vitest"
import { test } from "./fixtures/extension"
import {
	buildSyntheticBackup,
	deriveNuloAccountAddress,
	gotoPopupImport,
	importFullBackup,
	makeRandomMasterBase64,
	POPUP_IMPORT_SHELL,
	readActiveAccount,
	TEST_PASSWORD,
	writeBackupToTemp,
} from "./helpers/import-drivers"

const HAS_FIXTURE = process.env.NULO_E2E_MIGRATION_FIXTURE === "1"
const IS_RELEASE_ARTIFACT_RUN = !!process.env.EXTENSION_PATH

test("fixture-arming contract: unarmed runs are allowed ONLY against a release artifact", () => {
	if (!HAS_FIXTURE) {
		expect(
			IS_RELEASE_ARTIFACT_RUN,
			"NULO_E2E_MIGRATION_FIXTURE is unset on a repo-build run — the backup-migration smoke would silently skip. " +
				"Build with VITE_NULO_E2E_MIGRATION_FIXTURE=1 and set NULO_E2E_MIGRATION_FIXTURE=1 (see _smoke-e2e.yml).",
		).toBe(true)
	}
})

test.skipIf(!HAS_FIXTURE)(
	"a v1 backup migrates forward through the real import UI and restores current-shape rows",
	async ({ freshExtensionPerTest }) => {
		const masterBase64 = await makeRandomMasterBase64()
		const filePath = writeBackupToTemp(
			buildSyntheticBackup({
				masterBase64,
				// Derivation-consistent with the master (chainId 31337 = the synthetic network) —
				// the integrity coordinator blocks a mismatched import at finalize.
				accountAddress: await deriveNuloAccountAddress(masterBase64, 31337),
				extraData: {
					// PRE-shape contact row: carries `legacyName`, no `name` — exactly
					// what a v1 export would hold if v9001 had shipped as a real v2.
					contact: [
						{
							id: "syn-contact-1",
							profileId: "syn-profile-id",
							address: `0x${"02".repeat(32)}`,
							legacyName: "Migrated Ali",
							abbr: "MA",
						},
					],
				},
			}),
		)

		const page = await gotoPopupImport(freshExtensionPerTest)
		await importFullBackup(page, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)

		// Restore succeeded end-to-end: the imported account is active.
		const address = await readActiveAccount(page)
		expect(address.startsWith("0x")).toBe(true)

		// The contact slice was migrated to the CURRENT shape before restore
		// wrote it. Raw chrome.storage read from the page context, not the
		// app's facade.
		const contacts = await page.evaluate(async () => {
			const all = await chrome.storage.local.get()
			return Object.entries(all)
				.filter(([k]) => k.startsWith("nulo:core:contacts@"))
				.map(([, v]) => JSON.parse(v as string) as Record<string, unknown>)
		})
		expect(contacts).toHaveLength(1)
		expect(contacts[0].name).toBe("Migrated Ali")
		expect(contacts[0]).not.toHaveProperty("legacyName")

		expect(freshExtensionPerTest.pageErrors).toEqual([])
		await page.close()
	},
	90_000,
)

test.skipIf(!HAS_FIXTURE)(
	"a pre-baseline blob (legacy schema-version, no new fields) rejects with the re-export copy",
	async ({ freshExtensionPerTest }) => {
		const masterBase64 = await makeRandomMasterBase64()
		const filePath = writeBackupToTemp(
			buildSyntheticBackup({
				masterBase64,
				bodyOverrides: { "compat-epoch": undefined, "backup-schema-version": undefined, "schema-version": 2 },
			}),
		)

		const page = await gotoPopupImport(freshExtensionPerTest)
		await importFullBackup(page, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL, { expectError: "Incompatible backup" })

		expect(freshExtensionPerTest.pageErrors).toEqual([])
		await page.close()
	},
	90_000,
)
