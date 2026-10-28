# Integration acceptance checks

Report requested capabilities as passed, failed or not implemented. A screenshot
of Studio is not evidence that recording, storage, replay or capture works.

| Capability | Evidence |
| --- | --- |
| Manifest | Parse the actual lesson, including anchor objects and outcome/view paths. |
| Practice | Finish with real controls; verify valid alternate paths where appropriate. |
| Watch | Reset the fixture and run all actions without user clicks; verify final state, cancellation and unsupported-action errors. |
| Dialogs | Open the intended dialog, use an inside control and a body-portaled picker, and finish. Verify unrelated-dialog pause/resume and hidden-mounted dialogs do not block. |
| Keyboard | Reach tutorial controls inside the modal, operate the picker, check Escape ordering and opener-focus restoration. |
| Layout | Check a narrow viewport, scrolling, a replaced anchor, and light/dark modes. Keep required controls unobstructed. |
| Recovery | Hide/remove and restore an anchor; retry an action failure, navigate back and use the advertised restore action. |
| Lifecycle | Start, stop/unmount, restart and resume if enabled. Check duplicate actions/listeners and stale async writes. |
| Recording | Record three real operations, inspect semantic IDs/payloads/anchors, edit, save and reload. |
| Frame playback | Load the draft in the target iframe with the same persistent store. Verify readiness and both preview modes, including a non-root base path. |
| Seek | If offered, reset to the fixture and replay to a later step. If reset is unavailable, keep seek unavailable. |
| Capture | Run the child capture protocol; inspect screenshots, cleanup and surfaced failures/timeouts. |
| Export | Inspect the actual requested document, screenshots and metadata; verify prepared PDF preview and download use the same result. |
| Share | Round-trip a real token; reject routes outside the consumer allowlist and verify base-path behavior. |
| Isolation | Build/typecheck/test Tourkit without app aliases; keep app-specific code in host adapters. |
| Learner library | Verify search, type/status filters, cards/rows, Watch completion, interrupted Practice/reload/resume, and same-document/cross-tab status updates. |
| Scoped state | Reuse lesson IDs in two namespaces, verify independent progress/completion/preferences/review, and switch accounts during an in-flight action without leaking aliases or writes. |
| Optional review | Pin a comment, attach a snapshot, draw, reply, resolve/reopen, export/reimport, and reopen changed-content feedback through the inbox. |
| Standalone checkout | In a fresh Tourkit clone, `npm ci`, then build public JS/types/CSS and all five examples without application aliases or private submodules. |
| Source consumption | With a submodule, confirm the host resolves one copy of React (no `node_modules` inside the Tourkit directory) and declares Tourkit's runtime dependencies. |
| Validation report | Exercise unknown actions/fixtures, missing context for repeated controls, pre-satisfied outcomes, stale images and changed/expired evidence; then verify real runtime behavior separately. |

Choose rows that match the requested capability and changed behavior, then run
normal required repository gates. Verify Recording, Frame playback and Capture
separately for full authoring adoption. State when only the player is connected.
Keep offline interactive HTML unavailable until a working application runtime
provider exists; a static guide does not supply that runtime.
For a guide without a runnable stage, use supplied screenshots or disable
screenshot capture; the Studio export runner otherwise captures missing images.

