---
name: integrate-tourkit
description: Integrate or extend Tourkit, the React guided-tour library, in an application. Use for learner libraries, Practice/Watch lessons, semantic recording, the Tourkit Studio, iframe playback, screenshot capture, sharing, guide exports and optional review tools. Connect real host actions and state through adapters, preserve compatibility and module boundaries, and verify complete user flows in a browser.
---

# Integrate Tourkit

Build a working host integration, including the application behavior the lesson
needs. Reuse Tourkit's player, editors, dialogs and controls. Treat adding anchor
attributes or rendering Studio as the beginning of integration, not its proof.

## Find the implementation and select the scope

1. Read the repository's agent instructions and locate Tourkit. It is either
   a Git submodule compiled from source (often `modules/tourkit/`; read its
   `README.md` and `ADOPTING.md`) or the `tourkit` package installed from
   `github:ahzs645/tourkit` (inspect `node_modules/tourkit/package.json`
   exports and `dist/types`). It is not on the npm registry; do not invent a
   registry version. In a submodule, never run `npm install` inside the
   Tourkit directory: the host provides the dependencies, and a second React
   breaks hooks.
2. Inspect the host's state/store, commands, router, modal/portal primitives,
   styling and fixture/reset mechanism. Keep application adapters outside
   Tourkit.
3. Select the requested capability:
   - **Player:** manifest, anchors, snapshot, executor, navigation and modal
     cooperation. Read [player and dialogs](references/player-and-dialogs.md).
   - **Authoring:** also connect the semantic action stream, Studio environment,
     stage iframe and persistent draft store. Read
     [Studio host contract](references/studio-host-contract.md).
   - **Capture/share/export:** also connect the child capture runner, launch
     policy, assets and optional offline runtime. Use the same host contract.
   - **Learner library/review:** use the data-driven library and optional review
     entrypoints. Read [library, scope and review](references/library-scope.md).
4. Keep the boundary explicit. Core is usable without React; the shipped player,
   Studio and UI require React. Do not claim automatic support for non-React UI,
   cross-origin authoring, native top-layer dialogs or an arbitrary app's offline runtime.

## Define the host contract before writing lessons

Record a short integration map in the work or PR:

| User operation | Semantic action | DOM anchor | Snapshot outcome | Prerequisite |
| --- | --- | --- | --- | --- |
| Open creation dialog | `contacts.open-create` | `contacts.add` | `surfaces.create.open` is true | Contacts screen |
| Choose type | `contacts.set-type` | `contacts.type` | `draft.type` equals selected value | Creation dialog |
| Save contact | `contacts.save` | `contacts.save` | Matching contact exists | Valid draft |

Use the host's vocabulary. Do not copy actions, fixtures, catalogs or routes
from the examples or another host into the application.

- Put a stable, unique `data-tutorial-id` on each real control. Use an anchor
  object such as `{ id: "contacts.add" }` in a manifest; a string is invalid.
- Expose a fresh, serializable snapshot object when relevant state changes.
  Prefer outcomes over click counts. Keep training fixtures, payloads and
  screenshots free of secrets and real personal data.
- Execute through the same domain operations used by the UI. Await async
  work, return created objects for result aliases, and honor the abort signal.
- Observe user operations on the Tourkit action bus when recording or
  action-gated Practice is needed. An annotated button alone does not emit an action.
- Provide a deterministic training fixture and an explicit reset for replay.
  Do not reset real user work to satisfy a tutorial.
- Parse manifests with `parseTutorialManifest`/`TutorialManifestSchema`.
  Arbitrary outcome paths are allowed; v1 track/view-context keys remain finite.
  Read the schema before using `context` or generalizing its format.

## Implement one complete vertical slice

Start with a short lesson that opens a modal, uses a control inside it and
commits a result. Connect both real user input and Watch execution. Read
`examples/task-list.tsx` in Tourkit for the smallest player example; use
`examples/dialog-workflow.tsx` for a modal, dropdown and view-recovery workflow.
For a complete independent authoring implementation, use `examples/studio/`:
its real project interface supplies recording, fixtures, reset, seek, playback,
capture, shared links and persistent drafts. `examples/library.tsx` and
`examples/review.tsx` exercise learner and review workflows independently.

1. Parse the lesson, render the fixture, expose snapshot state and mount one
   `TutorialPlayer` for the active run, in the same document as its anchors.
2. Provide `onExecuteAction`. For `TutorialActionRegistry`, return
   `(await registry.execute(action, context.signal)).result`; the player needs
   the action result, not the event envelope. If sharing that executor with
   the authoring bridge, use optional context and `context?.signal`: the bridge
   calls it with only the action. See the typed adapter in the player reference.
3. Provide `resolveContextActions`/`resolveReturnAction` only when the host can
   restore that view. Use explicit `watch: true` or a durability policy for
   outcomes that should remain true. Surface an unavailable restore operation.
4. Include the theme once. Verify Tailwind scans Tourkit, CSS modules work and
   `.dark` reaches body portals.
5. Reuse `Modal`/`DialogShell` and `BuilderSelect`/`BuilderCombobox` for new
   Tourkit UI. For another modal library, implement and test the focus/portal
   contract in the player reference. Do not disable focus trapping globally.
6. Complete both parent and child contracts for Studio. A configured
   environment alone does not instrument the target application.
7. Create scoped persistence, action buses and optional review environments
   once per application/account. Pass the same instances to every participating
   adapter. Select a `TutorialDomPolicy` explicitly for a new host.

## Verify behavior, not just rendering

Use [the acceptance checks](references/acceptance-checks.md) for requested
capabilities, including keyboard interaction in a real browser. A mounted
editor does not prove recording, and an export button does not prove capture.

To check Tourkit itself after changing it, run its scripts from the Tourkit
checkout (a standalone clone; not a submodule whose dependencies the host
provides):

```sh
npm ci
npm run check
npm test
npm run build
npm run build:examples
npx playwright install chromium
npm run test:browser
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point at a compatible local Chromium
instead of the Playwright download. `npm run build:site` additionally builds
the examples site.

Run `npm run validate:lesson -- --input <lesson> --host <host.json>` against
actual host action/fixture metadata before browser acceptance. Its JSON/Markdown
findings describe structural, snapshot and evidence checks; a clean report does
not prove the host executes the lesson correctly.

Run the host's normal checks as well, including any replay or end-to-end suites
it already has. Cover new adapter behavior without removing compatibility
coverage. If validation is blocked, report the concrete missing
dependency/environment and mark that capability unverified.

## Finish with a useful handoff

Report implemented capabilities, adapter locations, action/anchor map,
fixture/reset behavior and how to run the example. Distinguish verified flows
from remaining work. Preserve one-way imports and application-owned lesson
content. This skill ships in Tourkit's `guidance/integrate-tourkit/`; keep its
API claims tied to shipped code.

