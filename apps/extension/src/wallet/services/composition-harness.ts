/**
 * Shared test-only helper for `*.composition.test.ts` harnesses.
 *
 * Builds a minimal `ServiceCollection`-addable stub for a dependency the
 * service-under-test resolves via `services.get(name)` — `{ name,
 * dependencies: [], start(), ...methods }`. Imported ONLY by test files. Lives
 * under `src/` (typecheck + lint cover it); harmless if it ever leaked to prod
 * (a no-op stub builder), so it carries no bundle marker.
 * See `apps/extension/tests/COMPOSITION-TESTS.md`.
 */
export function svc(name: string, methods: Record<string, unknown>) {
	return { name, dependencies: [], async start() {}, ...methods } as never
}
