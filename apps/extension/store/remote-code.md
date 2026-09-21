# What runs in the wallet that did not ship in the package

Both stores ask whether the extension executes remote code. This note describes, with file
references, what arrives from outside, what executes it, and what it can and cannot reach, so the
declaration ("No remote code", on both stores) rests on a stated mechanism rather than on a slogan.
`scripts/store-listing.test.ts` checks that every `path:line` cited here exists.

## What arrives

An application connected over the wallet-sdk channel can register a contract: an **instance**
(address preimage) and, optionally, an **artifact** (`packages/wallet-bridge/src/dispatcher.ts:1448-1455`).
The artifact is a JSON document — an ABI plus, per function, ACIR bytecode and Brillig bytecode
(`@aztec/stdlib/src/abi/abi.ts:248-249`). The wallet parses it against a schema before storing it
(`packages/aztec-runtime/src/pxe/service.ts:438-463`) and derives the contract address from the
preimage, refusing a mismatch. The artifact is **data**: it is never evaluated as JavaScript, never
injected into a page, never loaded as a script.

## What executes it

Contract functions run inside the Aztec PXE, hosted in a hidden extension document (Chrome's
offscreen document, or a frame of the background page on Firefox,
`apps/extension/src/wallet/utils/offscreen.ts:36-42`). The PXE feeds each function's bytecode to
the ACVM, a virtual machine compiled to WebAssembly and bundled in the package
(`@aztec/simulator/src/private/acvm_wasm.ts:71-79`;
`@aztec/pxe/src/contract_function_simulator/oracle/private_execution.ts:48`). The extension's
content security policy is `script-src 'self' 'wasm-unsafe-eval'`
(`apps/extension/manifest/manifest.config.ts:46-48`): bundled scripts and bundled WASM only, no
`eval`, no `Function()` — the one upstream package that built a function from a string is replaced
by a stub for that reason (`apps/extension/src/shims/function-bind-stub.cjs:1-28`).

## What the bytecode can reach

**Directly: nothing outside the VM.** The ACVM interprets an arithmetic circuit; a Brillig
opcode can request a *foreign call*, and the only foreign-call handler is the wallet's own oracle
(`@aztec/pxe/src/contract_function_simulator/oracle/acir_callback.ts:8-10`).

**Through the oracle, the calls it serves.** Utility functions get the methods of
`@aztec/pxe/src/contract_function_simulator/oracle/utility_execution_oracle.ts` (the public
methods from `:192` on: random fields, key validation, membership witnesses, block headers, contract
instances, auth witnesses, the caller's own notes and nullifiers, capsules and fact collections,
logging, nested utility calls). Private functions add the methods of
`@aztec/pxe/src/contract_function_simulator/oracle/private_execution_oracle.ts` (from `:118`:
context inputs, note creation and nullification notices, tagging secrets, hash preimages, log
emission). Some of those answers are fetched from the Aztec node the user configured — for example
a public-storage read (`@aztec/pxe/src/contract_function_simulator/oracle/utility_execution_oracle.ts:536-547`) becomes
`getPublicStorageAt` requests, and membership witnesses become the corresponding node queries
(`:256`, `:283`, `:312`, `:334`, `:352`, `:376`, `:505`). So a contract function **can cause
requests to leave the device, to one fixed endpoint it does not choose**, carrying the addresses and
slots it reads. It cannot name a host, send a body of its choosing, or read the response of
anything but the typed query the oracle made on its behalf.

**What it cannot reach:** extension APIs (`chrome.*`), the DOM of any page, the popup, storage
outside the PXE database, the network by any path other than the oracle above, and any host other
than the configured node. The host document itself talks to the service worker over
`chrome.runtime` messaging (`apps/extension/src/offscreen/index.ts:108`) and exposes no page-facing
surface.

## When it runs without a click

A connected application's calls go through the interaction service. `isConfirmationNeeded`
(`apps/extension/src/wallet/services/dapp-interaction/service.ts:658-687`) shows the confirmation
popup when the call's access level reaches the session's confirmation level, when a send has no
embedded fee payment, and always for token registration; the wallet-sdk session is created at
`AccessLevel.Transactions` (`apps/extension/src/wallet/services/wallet-sdk/background.ts:992`), so
sends and auth-witness creation prompt, while simulations and utility calls at lower levels run
silently for a session the user already approved (`apps/extension/src/wallet/services/dapp-interaction/service.ts:405-406`). A silent utility call can
therefore execute application-supplied bytecode and, through the oracle, cause node reads, with no
per-request window. What it cannot do is any of the things listed above.

## What this bears on

`legal/privacy.md` says, in § 2, that the content security policy forbids loading remote scripts,
and in § 13 that "the extension loads no remote code" (`legal/privacy.md:48-49`, `:325-326`). Under the
reading above — code is what the browser executes as script or WASM, and the package bundles all of
it — both sentences are true and stay as written. The Firefox reviewer notes and the Chrome
remote-code justification in `store/listing.md` summarise this note.
