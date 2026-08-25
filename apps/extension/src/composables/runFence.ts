/**
 * Generation fence for supersedable async runs. `begin()` bumps the shared
 * generation and hands back an `isCurrent` closure for THAT run — any later
 * `begin()` permanently invalidates every earlier run's closure. The idiom
 * `useProfileBootstrap` hand-rolls, extracted for its 2nd and 3rd users; a
 * per-call-site instance is deliberate (each site supersedes only itself).
 */
export interface RunFence {
	/** Start a run: bumps the generation and returns isCurrent for THIS run. */
	begin(): () => boolean
}

export function createRunFence(): RunFence {
	let generation = 0
	return {
		begin() {
			const mine = ++generation
			return () => generation === mine
		},
	}
}
