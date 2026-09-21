# Soak baselines — moved

The committed soak compacts now live with the tool that reads them: `scripts/ci-cd/test-soak/baselines/`
(`node/`, `bun/`, gitignored `full/`). The vitest 4.1.10 record that used to sit here (12 compacts per engine,
30 runs, commit `e10cc91e`) was retired when vitest 5 was adopted; the last commit holding it is `06a404d8`
(`git show 06a404d8:implementations-plan/vitest-on-bun/lessons/baselines/node/extension.json`). The tool
cannot compare across vitest versions (`checkMeta`), so those files are history, not a reference.
