# Draft issue for AztecProtocol/aztec-packages

For the owner to file; filing on someone else's tracker is not an agent action. Facts below were
read from the installed `5.2.0` packages on 2026-09-20.

**Title:** npm packages ship without licence files, and `@aztec/bb.js` declares MIT over an Apache-2.0 tree

**Body:**

We bundle the `@aztec/*` packages in a browser extension and generate a third-party notices file
from what the build renders. Three things make correct attribution harder than it needs to be:

1. **No licence file in any package.** None of the `@aztec/*` packages we bundle at `5.2.0`
   (`foundation`, `stdlib`, `pxe`, `aztec.js`, `accounts`, `bb.js`, `noir-acvm_js`,
   `noir-noirc_abi`, and the rest) contains a `LICENSE` or `NOTICE` file, and most have no
   `license` field either. Apache-2.0 § 4(a) asks redistributors to pass on a copy of the licence;
   today we reproduce the repository's text by hand and pin it to the version. Adding `LICENSE` to
   each package's `files` would fix this for every downstream.
2. **`@aztec/bb.js` declares `"license": "MIT"`**, has no `repository` field, and ships no licence
   file, while `barretenberg/LICENSE` in this repository is Apache-2.0. Which applies to the
   published package and to `barretenberg-threads.wasm.gz`? We currently ship the Apache-2.0 text
   and record the MIT declaration beside it.
3. **No inventory of what the wasm binaries compile in.** `barretenberg*.wasm.gz`,
   `acvm_js_bg.wasm` and `noirc_abi_wasm_bg.wasm` link third-party code (Rust crates, C++
   libraries, the wasm runtime), and none of the packages carries a listing (`cargo about` output,
   an SBOM, a `THIRD-PARTY` file). Downstream distributors cannot reconstruct the feature-matched
   dependency closure of your release build; you can emit it from the build that produces the
   artifact. Would you consider publishing one with each package?

Happy to send a PR for (1) if that helps.
