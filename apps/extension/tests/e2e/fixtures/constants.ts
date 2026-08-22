/** Canonical password for e2e profile registration + wallet-unlock flows.
 *  `onboarding-tab.test.ts` deliberately uses a DIFFERENT literal to prove the
 *  onboarding shell registers independently of this constant — do not collapse
 *  that one into here. */
export const TEST_PASSWORD = "TestPassword123!"

// ci-probe: no-op line to trigger the smoke gate against plain dev
