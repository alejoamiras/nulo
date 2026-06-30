import { markTestsStarted } from "./sentinel"

// Runs once per test-file worker, before any test body, AFTER global-setup. The
// first worker to load marks that test execution was reached — read by the boot
// classifier so a run where tests actually started is never misclassified as an
// infra-boot failure (exit 86).
markTestsStarted()
