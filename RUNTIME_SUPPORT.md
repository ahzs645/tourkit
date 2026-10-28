# Runtime support and compatibility

This describes the current integration contract. Instance factories separate
state; they do not imply that every DOM or transport arrangement is supported.
See [VERIFICATION.md](VERIFICATION.md) for measured browser/build evidence and
[README.md](README.md) for the public entrypoints.

## Supported composition

| Area | Current contract |
| --- | --- |
| Core | TypeScript/JavaScript schema, action, alias, check and replay logic without React or application imports |
| Browser UI | React and React DOM 19 (`^19.3.0` peers); ESM browser build targets ES2022 |
| Player | One active player per document, with real DOM anchors and immutable observable host snapshots |
| Studio | Same-origin parent workspace and instrumented stage iframe, with shared draft-store conventions |
| Capture | Same-origin stage replay; DOM capture in Studio or Chromium-native capture through the portable CLI |
| Draft persistence | Named IndexedDB database/store; memory implementation when IndexedDB is absent |
| Library | Arbitrary ordered section IDs; status records/adapters scoped to the intended app/user |
| Review | Optional environment/surface composition, local storage/in-memory fallback and portable file exchange |
| Tooling | Node 22 or later; Chromium and a local HTTP server capability for browser/native capture tests |

Automated browser acceptance exercises Chromium, desktop/narrow layouts and
nested deployment paths in the neutral examples. It is not a blanket browser
compatibility matrix or evidence for every application's CSS, controls and route
lifecycle. Audio recording also depends on the browser's media APIs and permission;
actions-only recording is available without a microphone.

## DOM and dialog policy

`TutorialDomPolicy` is supplied per player and capture run:

| Member or export | Meaning |
| --- | --- |
| `applicationDialogSelector` | Semantic modals that block outside controls and own Escape |
| `floatingWindowSelector?` | Foreground windows used to disambiguate repeated anchors, without treating each window as a blocking modal |
| `stepExpectsDialog(step)` | Host predicate for a step expected to open a dialog around an outside anchor |
| `SEMANTIC_APPLICATION_DIALOG_SELECTOR` | Open native dialogs, `aria-modal="true"` and open ARIA dialog surfaces |
| `NEUTRAL_TUTORIAL_DOM_POLICY` | Semantic dialog discovery with no host window selector or snapshot-key assumptions |
| `LEGACY_TUTORIAL_DOM_POLICY` | `.pb-modal-layer > .pb-window` floating windows and the `surfaces.*` outcome convention of Tourkit's first host |
| `DEFAULT_TUTORIAL_DOM_POLICY` | Currently the legacy policy; used when `domPolicy` is omitted |

A new host should explicitly select the neutral policy and add its own dialog
predicate/selector if needed. Pass the policy to `TutorialPlayer`,
`TutorialCaptureRun` and direct anchor helpers used by the same workflow.
The full Studio example defines its project policy in one host-owned file.

The following are **not guaranteed** by the current implementation:

- Multiple simultaneous active players in one document. Driver/UI queries and
  focus behavior remain document-scoped even when storage/buses are independent.
- Shadow DOM anchor traversal or an arbitrary custom portal root.
- Correct overlay stacking/input behavior above native top-layer dialogs and
  popovers. Recognizing an open `<dialog>` does not prove top-layer integration.
- Cross-origin Studio, seeking, screenshot capture or shared draft access.
- An offline interactive bundle for an arbitrary application.

Use the existing dialog/surface markers and browser checks for supported modal,
portaled dropdown, nested scrolling and keyboard behavior. Extending a selector
alone is insufficient evidence for one of the unsupported arrangements.

## Scope services deliberately

Construct services once for the intended app/user/run and dispose subscriptions
when that scope ends. Avoid recreating a progress store on each render. Changing
`TutorialPlayer.progressStore` switches its runtime scope and clears the old run's
in-memory aliases/progress before loading the new scope.

`createTutorialActionBus` gives an independent observed-action stream; pass its
bound subscription to the player and its object through
`TutorialSessionIntegration.actionBus`. `createTutorialSurfaceRegistry` gives
independent reported surface state; `useReportTutorialSurface` accepts a registry.
`createTutorialReviewStepStore` gives an independent current-step channel; pass
its `reportStep` to `onStepChange` and the same store to `TutorialReviewLayer`.
Reset that channel for a new run. Omitted services fall back to shared module-level defaults.

A namespace is an application-owned record prefix, **not a security boundary**.
Same-origin scripts can access browser storage regardless of namespace. There is
no built-in authentication, tenant authorization, server synchronization or user
account migration. The host chooses safe demonstration data, account-switch
behavior and cleanup/retention rules.

## Storage and wire identifiers

Tutorial storage factories build keys with one rule. Without a namespace a key
is `tourkit:<name>`; with a namespace it is `<namespace>:tutorial:<name>`, the
namespace URI-encoded first.

| Data | Location and key without a namespace | Scoped factory |
| --- | --- | --- |
| Interrupted player run | Session storage, `tourkit:progress:<id>` | `createTutorialProgressStore` |
| Lesson completion | Local storage, `tourkit:completions` | `createTutorialCompletionStore` |
| Reusable editorial blocks | Local storage, `tourkit:content-templates` | `createTutorialContentTemplateStore` |
| Export options | Local storage, `tourkit:export-settings` | `createTutorialExportPreferences` |
| Export presets | Local storage, `tourkit:export-presets` | `createTutorialExportPresetProfile` |
| Narration recording mode | Local storage, `tourkit:narration` | None |
| Studio layout (panel width/visibility, timeline, stage zoom, overlay, follow-step view) | Local storage, `tourkit:studio-*` | None |
| Editable drafts | IndexedDB, database `tourkit-studio`, store `drafts` | `createDefaultTutorialDraftStore` |
| Reviewer identity, reviews and inbox | Local storage under the `tourkit-review` namespace | `createReviewStorage`, `createReviewInboxStore`, `createReviewEnvironment` |

A host can supply a lazy storage provider instead of the browser default.
Naming a new namespace or database creates a separate scope; it does not move
existing data. Draft storage is shared by Studio, its stage and capture, so all
three must use compatible names and implementations.

Progress/completion `.subscribe` reports same-document writes across matching
instances (through a `tourkit:storage-change` window event) and relevant
browser `storage` events. Progress remains session/tab storage by default.
Local-storage completion can update other tabs. Stopping or finishing clears an
interrupted run; completion is marked separately by the host's completion
handler. Storage failures must not prevent the learner from finishing, but this
does not guarantee persistence when browser storage is blocked or full.

Review has its own `createReviewStorage`, `createReviewInboxStore` and
`createReviewEnvironment` contracts. The review factories accept key functions,
so a host can keep its own historical keys. Review's in-memory fallback keeps
current feedback when storage cannot persist it. See the
[review contract](review/README.md) for merge/import behavior.

Other identifiers on the wire or in the DOM:

| Identifier | Value |
| --- | --- |
| Studio/stage iframe protocol | `tourkit-v1` |
| Capture handshake protocol | `tourkit-capture-v1` |
| Overlay CSS classes | `tourkit-ring`, `tourkit-pointer`, `tourkit-surface`, `tourkit-popover` |
| Overlay CSS variables | `--tourkit-*` |
| Studio stage overlay element id | `tourkit-stage-overlay` |
| Review feedback file format and HTML data id | `tourkit-review-feedback` |
| Review handoff messages | `tourkit-review-ready`, `tourkit-review-bundle` |
| Review annotation URNs | `urn:tourkit:` |
| Share token prefix | `t1` |

Review files written before the rename, in the `webforms-review-feedback`
format (and the matching HTML data id), are still read; they are never written.
Tourkit does not read browser storage written under pre-release keys. A host
with such data migrates it itself.

## Manifest and protocol compatibility

Manifest version 1 has a fixed track enum and fixed view-context keys (see
[Current limitations](#current-limitations)); its fixture/path/hash launch
structure is also fixed.
Action IDs and snapshot outcome paths are application-defined. A library section
such as `purchasing` or `observatory` is an independent presentation ID; it does
not require changing the manifest track.

Share tokens, draft formats and review bundle fields are kept readable through
compatibility readers. Changing a wire or storage identifier requires an
explicit compatibility plan.

The share codec's allowlist constrains accepted launch paths/hash keys. The
iframe/capture handshake validates origin/source/token as appropriate. These
mechanisms do not turn local lessons into signed trusted documents or establish
cross-origin Studio support.

## Assets, evidence and offline behavior

Default PDF exports use bundled Roboto. Alternate Liberation Sans is available
only when the host supplies all four font URLs and serves them successfully.
The same host owns base-path resolution for stage URLs, routes and other assets.
The pinned sharing distribution and its notices ship with Tourkit.

HTML guides and SCORM reading courses can be offline documents. Interactive HTML
needs `TutorialExportRuntime.interactive`; it is unavailable when no host bundle
provider is configured. Shared lesson links need the recipient's compatible host
application. They omit screenshots and recorded narration, while permitted
same-site narration references still need their served assets. Local draft storage
does not itself make that host application available offline.

Static validation and screenshot fingerprints report declared contracts and
changes. A current fingerprint is not proof of correctness or authenticity.
Practice and Watch must both be exercised in the host, and generated screenshots
and documents need visual review. The validation report states these limits;
checks against the host's own documentation remain the host's responsibility.

## Current limitations

Some vocabulary from Tourkit's first host is still in the code. These are
known, and are candidates for a versioned change:

- **Track enum.** `TutorialTrackSchema` accepts only `getting-started`,
  `building`, `logic`, `clinical-data` and `delivery`, and
  `DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT.tracks` titles them. Use library
  sections for your own curriculum categories.
- **View-context keys.** The v1 keys (`workspace.activeTab`,
  `host.emulator`, `host.module`, `host.node`, `host.view`, `host.tab`,
  `host.page`, `host.menu`, `host.browserTab`, `host.dialog`) are fixed. Map
  your screens onto them.
- **Default DOM policy.** `DEFAULT_TUTORIAL_DOM_POLICY` is
  `LEGACY_TUTORIAL_DOM_POLICY`, which recognises `.pb-window` floating windows
  and treats `surfaces.*` checks as dialog-opening. Pass
  `NEUTRAL_TUTORIAL_DOM_POLICY` (or your own policy) explicitly.
- **Review anchors and kinds.** `REVIEW_ANCHOR_ATTRIBUTES` lists
  `data-field-id` together with a few renderer-specific `data-*` attributes
  from the first host; surfaces can anchor to any `data-*` attribute. The
  built-in subject kinds are `form`, `tutorial` and `emr`; other hosts use their
  own lowercase kind IDs.
- **Review wire fields.** A picture attachment's confirmation field is named
  `noPatientData` (it must be `true`), and a bundle describes its subject under
  a `form` key whatever the subject kind. `createReviewEnvironment({ attachmentConfirmation })`
  words the confirmation for your domain; the field names are part of the file
  format.
