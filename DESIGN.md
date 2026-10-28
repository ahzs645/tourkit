# Tourkit design patterns

Tourkit separates lesson semantics, application behavior and reusable interface
machinery. These patterns explain the implemented boundaries; the source links
lead to the current contracts. [README.md](README.md) documents public APIs,
[ADOPTING.md](ADOPTING.md) covers host adoption, and
[RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md) defines runtime limits.

## One operation, several ways to teach it

Separate a domain operation from the gesture that invokes it. A button can call
`projects.save` and report the observed action. Watch calls the same operation
through an executor. Recording subscribes to semantic events instead of guessing
meaning from screen coordinates.

This permits an invoice or map-editing workflow to use its own action vocabulary.
Stable anchors identify controls to highlight, while the action describes what
the host does. Keep observation and replay separate to avoid recording a
programmatic demonstration as a second user gesture. A host-owned action bus can
be passed through the player and authoring session instead of sharing another
application's events.

Sources: [action bus/registry](core/actions.ts),
[recording action source](recording/action-source.ts),
[neutral project model](examples/studio/project-model.ts),
[session integration](components/tutorial-session.ts).

## Grade the result and demonstrate a route to it

Practice can accept any valid route to an outcome, while Watch demonstrates a
chosen route. A check such as “a new project with this priority exists” survives
more interface changes than an assertion about one exact click. Reading steps
use explicit continuation, because reading and performing a task are different
lesson goals.

Delta checks distinguish new records from pre-existing ones. Result aliases let
later steps refer to a record created in this run without hard-coded IDs. Keep
action-only grading for operations whose outcome the host snapshot cannot
represent, and keep snapshots small and relevant to the lesson.

Sources: [checks](core/checks.ts), [aliases](core/references.ts),
[manifest schema](core/schema.ts), [player](player/tutorial-player.tsx).

## Recover the screen separately from rebuilding state

Returning to a closed dialog is navigation. Repeating a save is a mutation. The
host supplies view restoration separately from replay/catch-up, and a reset must
resolve after the fresh state and DOM have committed.

The project example reopens its dialog without clearing partially entered data.
A deliberate fixture reset restores the authored starting state. Seek and resume
then replay earlier operations with fresh aliases and check the resulting state.
This prevents a correctly restored screen from being mistaken for a correctly
reconstructed workflow.

Sources: [view comparison](core/view-context.ts), [seek](core/stage-seek.ts),
[player integration types](player/types.ts),
[Studio example](examples/studio/README.md).

## Treat overlays as part of the working interface

Instructions must cooperate with real dialogs, nested scrolling, portaled
pickers, focus and changing geometry. Stable anchors, ARIA relationships and
surface markers form a contract between controls and the tutorial renderer.
Re-resolve replaced controls and expose temporarily missing anchors as a visible
recovery state.

Host-specific foreground windows and dialog-opening checks belong in
`TutorialDomPolicy`. The neutral policy avoids host CSS/snapshot assumptions;
the default is still a legacy policy from Tourkit's first host, so new hosts
pass the neutral one explicitly. Scope this policy per player/capture run. Test actual keyboard and pointer use, because a well-positioned
screenshot does not establish that the learner can operate the control.

Sources: [DOM policy](player/dom-policy.ts), [anchors](player/anchor.ts),
[placement](player/floating-placement.ts), [overlay](player/tutorial-overlay.tsx),
[dialogs](ui/dialog-shell.tsx), [pickers](ui/builder-select.tsx).

## Keep an editable draft and a validated delivery format

Authoring needs partial steps, media, timestamps, versions and reversible edits.
Playback needs a validated manifest with actions, checks, anchors and launch
information. Convert at a defined boundary and test round trips instead of making
every transient editor state publishable. A reading guide can contain editorial
blocks without becoming a playable task.

`TutorialWorkspace` composes the personal draft library and editor while the host
owns history and routes. The per-tree environment supplies capabilities and data;
it is not a mutable global catalog. The AI editing prompt is a provider-neutral
handoff of the semantic timeline, followed by the same validation and host checks
as any other edit.

Sources: [draft conversion](recording/draft.ts),
[serialization](recording/serialization.ts), [draft storage](recording/draft-store.ts),
[workspace](studio/TutorialWorkspace.tsx), [environment](studio/environment.tsx),
[AI handoff](recording/ai-prompt.ts).

## Present curricula without owning the application catalog

A published lesson library accepts ordered sections, manifests and status. It can
render cards or rows, filters, setup, progress and next-lesson controls without
knowing a host registry, router or lesson source. Section IDs are arbitrary
presentation categories even while manifest v1 keeps its fixed track enum.
Export menus and launch behavior remain explicit capabilities.

Status belongs to the selected persistence scope. The adapter caches by actual
ordered lesson IDs and source instance, then invalidates for local writes and
matching browser storage events. Equal catalog lengths do not imply identical
lessons. Completion wins over stale interrupted progress; a repeated lesson
counts once in the overall summary.

Sources: [library model](library/model.ts), [status source](library/status-source.ts),
[library UI](library/tutorial-library.tsx), [two collections](examples/library.tsx).

## Separate persisted scope while retaining compatibility

Factories let a host select app/user storage, buses and review step channels.
Without a namespace, records use shared `tourkit:` keys; explicit namespaces
produce separate records. Renaming a key is a data migration, so Tourkit
documents its keys and leaves migration of older data to the host that wrote
it. Selecting a different scope should change the
service instance and clear prior run state, not reuse a cache for another user.

Record separation is not access control, and independent buses do not solve
document-scoped overlay behavior. Keep these limits explicit rather than implying
multi-player or multi-tenant security from a namespace option.

Sources: [storage channel](shared/storage.ts), [progress](player/progress.ts),
[completion](player/completion-store.ts), [surface registry](player/surfaces.ts),
[review step store](review/tutorial-step-store.ts),
[runtime policy](RUNTIME_SUPPORT.md).

## Give export formats one document model

Build one ordered document from authored content and screenshots, then render it
into PDF, slides, Word, HTML or other reading formats. This reduces disagreement
between formats about which steps and instructions belong in the guide.

An offline interactive application additionally needs the host's UI, actions and
fixtures through a runtime provider. Missing screenshots may also require a live
stage, even for a static guide. Fonts and deployment paths are explicit host
capabilities; the neutral exporter does not assume application asset directories.

Sources: [document model](export/document.ts), [export dispatch](export/index.ts),
[runtime provider](export/runtime.ts), [PDF assets](export/pdf.ts),
[export runner](components/tutorial-export-runner.ts).

## Attach evidence to a particular lesson and state

Capture/replay uses an explicit handshake. Screenshot provenance includes a
fingerprint of relevant step state, and validation uses the same freshness
implementation. Native Chromium capture and DOM-based capture are different
implementations with separate rendering limits. Native capture bundles its
browser helper so imported dependencies survive execution in a fresh browser.

A static validator checks schema, host declarations and supplied snapshots. It
must not invent action effects or treat the initial fixture as an observed
pre-step state. A passing Watch run does not prove Practice usability; an old
result does not validate a changed manifest; a fingerprint does not prove source
fidelity. Reports carry scope, dates, change fingerprints and distinct warnings.

Sources: [capture protocol](recording/capture-protocol.ts),
[capture service](recording/capture-all.ts), [freshness](recording/screenshot-freshness.ts),
[native CLI](tooling/capture-native.mjs),
[native browser helper](tooling/native-capture-helper.mjs),
[portable validation](tooling/validate-lesson.ts).

## Review the subject through a small surface contract

`ReviewSurface` describes a subject's parts, anchors, pages and current visibility.
Comments and drawings can follow those parts through layout changes and review
rounds. A proposal paragraph, a tutorial step and a form field can all use that
contract without sharing domain models.

The review addon remains optional. It owns model/UI/file exchange and scoped
browser storage; consumers own labels, point-to-part mapping and application
notes. Retain wire fields and compatibility readers even when their historical
names are narrower than the new host vocabulary. A mismatched review can be
inspected without silently merging it into the current subject.

Sources: [surface contract](review/surfaces.ts), [model](review/model.ts),
[environment](review/environment.tsx), [review documentation](review/README.md),
[proposal example](examples/review.tsx).

## Prove portability with a consumer

A directory move does not prove independence. Build the package and unrelated
host examples, inspect their actual import graph, then install from the
package's own manifest and lockfile in a fresh checkout. Exercise Studio's
parent/iframe lifecycle and real exports in a browser, with no production host
content or adapters present.

Keep narrow entrypoints so a core consumer does not import authoring or review
UI. Keep optional assets, codecs and tooling explicit so development inside a
larger application cannot conceal an undeclared requirement. Record measured
evidence and limitations separately from the architecture's intended behavior.

Sources: [boundary checker](tooling/boundaries.mjs), [package build](tooling/build.mjs),
[example builder](tooling/build-example.mjs), [site builder](tooling/build-site.mjs),
[verification record](VERIFICATION.md).
