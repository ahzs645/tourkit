# Tourkit

Guided tours for React applications. A lesson names your application's own
actions and the state they should produce; Tourkit plays it as hands-on
Practice or as a Watch demonstration, records new lessons from real use in an
authoring Studio, presents published lessons in a library, captures screenshots
and exports guides. An optional review layer adds pinned comments and drawings
to any interface. Tourkit imports no application routes, catalogs, fixtures or
state stores; the host supplies them through adapters.

Tourkit was extracted from, and is used by, the Webforms form builder.

**Live examples:** <https://ahzs645.github.io/tourkit/> — five unrelated hosts
built from [`examples/`](examples).

## Features

- **Practice and Watch playback** of one lesson. Practice grades the outcome in
  the host's state, so any valid route counts; Watch runs the same domain
  operations through an executor.
- **Semantic recording** of real user operations into editable steps, with
  suggested outcome checks from a host-supplied provider.
- **Studio**: a draft library and editor around a live, same-origin stage
  iframe, with seek, previews, screenshot review and draft import/export.
- **Lesson library**: sections, search, type/status filters, cards or rows,
  progress and a next-lesson suggestion.
- **Screenshot capture** in the browser (DOM-based) or through a Chromium CLI,
  with step fingerprints for freshness.
- **Exports** from one document model: PDF, DOCX, PPTX, HTML, Markdown,
  animated GIF and SCORM 1.2, plus editable draft and player JSON.
- **Share links** with a host-defined allowlist of launch paths and hash keys.
- **Optional review addon**: pinned comments, notes, drawings, pictures,
  replies, rounds, an author inbox and portable feedback files.
- **Static lesson validation** against declared host actions and fixtures,
  with JSON or Markdown reports.

## Install

Tourkit is not on the npm registry yet. It needs Node 22 or later and React 19
(`react` and `react-dom` `^19.3.0` are peer dependencies).

### From GitHub with npm

```sh
npm install github:ahzs645/tourkit
```

The package's `prepare` script runs the build, so installing from Git produces
`dist/` (ESM, TypeScript declarations, combined CSS and an import-graph
manifest). Import the subpaths:

```tsx
import { TutorialPlayer, NEUTRAL_TUTORIAL_DOM_POLICY } from "tourkit/player";
import { TutorialLibrary } from "tourkit/library";
import "tourkit/styles.css";
```

Runtime dependencies stay external to the ESM build; your bundler resolves
them from the installed package's dependencies. All files under `dist` travel
together, including shared chunks.

### As a Git submodule, compiled from source

```sh
git submodule add https://github.com/ahzs645/tourkit.git modules/tourkit
```

Import the source entrypoints (`modules/tourkit/player`, `.../library`, and so
on) and let the host's bundler compile them. This is how Webforms consumes
Tourkit. In this arrangement:

- The host declares every dependency listed in Tourkit's `package.json`
  `dependencies` in its own `package.json`, and provides React itself.
- **Do not run `npm install` inside the submodule.** A second `node_modules`
  there gives the bundler a second copy of React, and hooks fail.
- The bundler must compile TypeScript/TSX and support CSS imports, including the
  checkbox's CSS module and Driver's CSS. See [Styles](#styles-and-examples).

[ADOPTING.md](ADOPTING.md) covers assets, fonts, the share codec, native
capture of another host and validation evidence for a new integration.

## Public entrypoints

The package exposes twelve JavaScript subpaths plus `styles.css`. Source
consumers use the corresponding directories and files.

| Subpath | Main responsibility and APIs |
| --- | --- |
| `core` | React-free manifest/schema validation, `createTutorialActionBus`, action registry, aliases, checks, view comparison and semantic replay |
| `player` | `TutorialPlayer`, anchor helpers, iframe controller, `TutorialDomPolicy`, scoped progress/completion stores and surface registry |
| `recording` | Semantic/visual recorders, draft conversion/serialization/storage, content blocks and check-suggestion interfaces |
| `export` | `exportTutorial`, format metadata, export options/preferences/presets and `TutorialExportRuntime` |
| `studio` | `TutorialWorkspace`, `TutorialStudio`, `MyTutorials`, `TutorialStudioEnvironmentProvider`, `TutorialCardMenu` and `TutorialBulkExport` |
| `ui` | Shared buttons, inputs, dialogs, tooltips, search and selection controls |
| `library` | `TutorialLibrary`, lesson cards/rows, progress summaries, status-source adapters and section models |
| `review` | Optional review model, storage, inbox, file exchange, layers and tutorial/Studio bindings |
| `share` | `createTutorialShareCodec` and its launch-route/hash-key policy |
| `session` | URL/session hooks, `TutorialSessionIntegration`, draft loading and the authoring bridge |
| `capture` | `TutorialCaptureRun`, capture protocol, framing, replay, screenshot capture and freshness helpers |
| `validation` | `validateTutorialLesson`, host metadata schema, lesson fingerprint and JSON/Markdown report model |

There is no root barrel that loads every feature. `core` cannot import React or
higher layers; core, player, recording and Studio do not import the optional
review addon. Boundary checks inspect source imports, CSS dependencies and build
inputs. The directories are subpaths of one package, not independently
versioned packages.

The application supplies lesson content, ordering, routes, snapshots, semantic
actions, fixtures and reset behavior, launch policy and any offline host
runtime. Keep those adapters in the application, outside Tourkit.

## Player integration

A lesson describes actions and outcomes. The host executes those actions and
supplies a fresh immutable snapshot whenever relevant state changes. Controls
carry stable `data-tutorial-id` attributes; optional `data-tutorial-aliases`
provide compatible alternate identifiers. Manifest anchors are objects such as
`{ id: "projects.save" }`, not strings.

```tsx
<TutorialPlayer
  manifest={lesson}
  state={{ projects, draft }}
  mode="practice"
  domPolicy={NEUTRAL_TUTORIAL_DOM_POLICY}
  onExecuteAction={executeProjectAction}
  subscribeToActions={subscribeToProjectActions}
  progressStore={projectProgress}
  onComplete={() => projectCompletions.mark(lesson.id, "practice")}
/>
```

The host defines `executeProjectAction`, a stable subscription callback that
calls `projectActionBus.subscribe(listener)`, and the scoped stores. Use the
same domain operation for a real control and for Watch playback. Recording
observes user operations; replay should not emit a second user gesture. Outcome
paths and action IDs use the host's own vocabulary. Tourkit does not implement
a host's business actions.

`resolveContextActions(context)` restores an expected view;
`resolveReturnAction(step)` can reopen a missing control's surface;
`isDurableCheckClause(clause)` chooses outcomes to keep observing. These
policies are host inputs. Without a context resolver the player infers no
navigation; without a durability policy only clauses with `watch: true` are
durable.

`TutorialDomPolicy` supplies `applicationDialogSelector`, an optional
`floatingWindowSelector` and `stepExpectsDialog(step)`. Start with
`NEUTRAL_TUTORIAL_DOM_POLICY` and override the dialog-opening predicate for your
own outcomes. Pass the policy explicitly: when `domPolicy` is omitted the player
uses `DEFAULT_TUTORIAL_DOM_POLICY`, a legacy policy kept for an existing
consumer (see [RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md#current-limitations)).
Supply the same policy to playback and capture.

### Product tours

A tour that explains an interface, rather than teaching a task, is a lesson of
`completion: "continue"` steps. Steps advance on Next, nothing is graded, and
`interaction: "guided"` keeps stray clicks from opening other surfaces
mid-tour. The player options below give such a tour the look and wording of
the host's own interface:

```tsx
const tour = parseTutorialManifest({
  schemaVersion: 1, id: "welcome", title: "Welcome", launch: { fixture: "app" },
  interaction: "guided", card: { size: "compact", pointer: false },
  chapters: [{ id: "tour", title: "Tour", steps: [
    { id: "files", completion: "continue",
      anchor: { id: "files.list", placement: "right", align: "start" },
      prepare: [{ id: "sidebar.open" }],
      overlay: { title: "Your files", body: "Everything you saved is here." } },
  ] }],
});

<TutorialPlayer
  manifest={tour}
  mode="practice"
  domPolicy={NEUTRAL_TUTORIAL_DOM_POLICY}
  onExecuteAction={runTourAction}
  persistProgress={false}
  keyboardNavigation
  labels={{ practice: "", progress: "{current} of {total}", next: "Next", finish: "Done", skip: "Skip tour" }}
  appearance={{ overlayOpacity: 0.7, stagePadding: 8, stageRadius: 8, cardGap: 12, ring: false, showSkip: true }}
  onStepChange={(step, index) => track("tour_step", { step: step.id, index })}
  onComplete={markTourDone}
  onStop={markTourSkipped}
/>
```

- `step.prepare` lists host actions run through `onExecuteAction` before the
  step's anchor is located, in every mode and on every entry (Back included):
  opening a drawer, switching a tab or a mobile pane. They must be repeatable
  navigation; they are not the learner's action and are never graded. An
  executor may return a promise to wait for an animation to settle.
- `anchor.align` (`start`, `center`, `end`) lines the attached card up with
  one edge of the control along the side `placement` chose.
- `card.size: "compact"` is a narrower card with smaller type for short copy.
- `labels` replaces every word on the player's own surfaces; `{current}`,
  `{total}` and `{criterion}` are filled in. `DEFAULT_TUTORIAL_PLAYER_LABELS`
  lists the keys.
- `appearance` sets the backdrop colour and opacity (an explicit opacity
  dims Practice too), the cutout's padding and radius, the card's gap, whether
  the accent ring is drawn, and a text Skip button that stops the run.
- `keyboardNavigation` lets ArrowRight and ArrowLeft press Next and Back
  while the card offers them, except in editable fields and open application
  dialogs. Escape always stops.
- `onComplete` fires on Finish and `onStop` on the stop icon, Skip or Escape,
  so a host can tell a finished tour from a skipped one.

Theme the card and ring with CSS variables on `.tourkit-surface` and
`.tourkit-overlay`. Tourkit's defaults have zero specificity, so a host rule
wins in any stylesheet order:

```css
.tourkit-surface, .tourkit-overlay {
  --tourkit-bg: var(--card);
  --tourkit-ink: var(--card-foreground);
  --tourkit-ink-2: var(--muted-foreground);
  --tourkit-accent: var(--primary);
  --tourkit-accent-ink: var(--primary-foreground);
  --tourkit-ring: var(--primary);
  --tourkit-font: inherit;
}
```

The other variables are `--tourkit-ink-3`, `--tourkit-line`,
`--tourkit-line-soft` and `--tourkit-track`.

## Published lesson library

The learner library takes plain ordered sections and status records. Section
IDs are independent of the manifest's fixed track vocabulary.

```tsx
const sections = [
  { id: "purchasing", title: "Purchasing", tutorials: purchasingLessons },
  { id: "stock-control", title: "Stock control", tutorials: stockLessons },
];

<TutorialLibrary
  sections={sections}
  statuses={statuses}
  onLaunch={(tutorial, mode) => startTraining(tutorial, mode)}
  layout="rows"
/>;
```

Use `launchHref(tutorial, mode)` for links or `onLaunch` for controlled
playback. Modes are `practice` and `autoplay`. The component includes search,
lesson-type and status filters, cards/rows, setup and prerequisite details,
section navigation, duration/level labels and progress badges.
`TutorialLibraryProgress` adds total completion and a next/continue suggestion;
`renderMenu` provides optional host menus, and `tutorialLibraryExportGroups`
preserves section grouping for export. The supplied `TutorialCardMenu`,
`TutorialBulkExport` and `TutorialExportGroup` type are exported from `studio`;
wrap that UI in the host's `TutorialStudioEnvironmentProvider`. Plain library
browsing does not require a Studio environment or export dependency.

`createTutorialLibraryStatusSource({ readCompletions, readProgress, subscribe })`
and `useTutorialLibraryStatuses(tutorialIds, source)` adapt persistent state.
The cache belongs to the source instance and the actual ordered IDs, so
same-length catalogs cannot share stale results. Subscribe to local writes as
well as matching browser storage events, or call `source.invalidate()` after
non-observable writes. Completion takes precedence over interrupted progress;
unfinished progress is suggested before a new lesson. See
[library/README.md](library/README.md) and the
[two-collection example](examples/library.tsx).

## Studio, recording and capture

`TutorialWorkspace` composes the personal draft library and editor without a
router. The host controls `openDraftId` (`null` for the library, an ID for the
editor, `undefined` while loading), `onOpenDraft`, headers and toolbar slots.
`TutorialStudioEnvironmentProvider` supplies one environment per React tree.
Start from `DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT`; its catalog and stage list are
empty and review is absent.

The environment defines catalog loading, stage/fixture choices, draft creation
and storage, routes, view restoration, anchor inference, suggested checks,
sharing, export/capture runtimes, optional review and navigation links. A
`TutorialCheckSuggestionProvider` projects the host's semantic operations into
suggested checks; Tourkit does not infer another application's state model by
itself.

The stage supplies `TutorialSessionIntegration`, an observed action bus, a
reset that resolves after state and DOM commit, draft loading, and a choice of
authoring, learner or capture mode. Studio and its stage share an origin and
compatible draft storage. Changing the iframe controller's `targetOrigin` alone
does not make cross-origin authoring work.

The [Studio example](examples/studio/README.md) implements a complete
project-creation workflow: modal/dropdown recording, edit/save/reload, seek,
Practice/Watch, screenshot review/capture, document export, draft import/export
and shared playback in a fresh browser context. Its launch paths work below a
nested deployment path.

The `capture` entrypoint supports DOM-based capture in Studio. The separate
native CLI uses Chromium pixels and the same stage replay handshake:

```sh
npm run capture -- --manifest lesson.tutorial.json \
  --base-url http://localhost:3000 \
  --launch-url http://localhost:3000/training/stage.html \
  --database my-tutorial-drafts --out output/lesson
```

The running stage must implement the capture protocol and read the specified
draft database/store. `--draft` accepts an editable draft instead of a
manifest; `--store`, `--region-selector`, `--margin`, `--viewport` and
`--channel` configure storage, framing and browser selection. The runner writes
PNGs, a capture report, an editable draft, HTML, Word and PDF. Native captures
are marked unreviewed; inspect the images before distributing them.
`--tutorial <id>` requires an application wrapper that supplies catalog lookup.
See [ADOPTING.md](ADOPTING.md#native-capture-of-another-host) for the
programmatic runner.

## Exports, assets and sharing

`exportTutorial(source, format, onProgress?, options?, runtime?)` accepts a
draft or manifest. Reading formats share one document model: PDF, DOCX, PPTX,
HTML, Markdown, animated GIF and SCORM 1.2. Draft and player JSON preserve
their own editing and delivery contracts. SCORM is an offline reading course.
Interactive HTML requires an explicit `TutorialExportRuntime.interactive`
provider containing the host application, fixtures and actions.

Static guides use saved screenshots; if screenshots are requested but absent,
mark the affected steps text-only, capture them, or disable screenshots. A live
stage is required only when images need replay/capture. Default PDF output
embeds Roboto through pdfmake. Optional Liberation Sans requires all four URLs
in `runtime.pdfFonts.LiberationSans` (`normal`, `bold`, `italics`,
`bolditalics`); the host serves those files and their licence under its actual
base path. Missing configuration or failed font loads produce an error instead
of an invisible fallback.

`createTutorialShareCodec(policy)` accepts the host's allowed launch paths and
hash keys. Tourkit contains a pinned browser distribution of json-url under
[vendor/json-url](vendor/json-url/README.md), with provenance and notices;
installation does not rebuild it. `t1` tokens, checksums and codecs are stable.
Shared lesson links omit screenshots and recorded narration; same-site
narration asset references can remain. The recipient needs the compatible
instrumented application and referenced assets. Use draft export for an
editable copy with its saved media.

## Optional review addon

The `review` subpath provides pinned comments, notes, drawings, pictures,
replies, rounds, resolve/reopen, fingerprints, snapshots, an author inbox and
file exchange. A `ReviewSurface` supplies the subject's ID/kind, parts,
anchors, current view and point-to-part mapping. `createReviewEnvironment`
supplies labels, storage and the inbox through `ReviewEnvironmentProvider`.

Use `ReviewFeedbackLayer` for an arbitrary interface, `TutorialReviewLayer`
with a scoped `createTutorialReviewStepStore` for a lesson, or
`StudioReviewHost` through `TutorialStudioEnvironment.review`. The addon is
optional; its subject kinds accept the application's own vocabulary. See
[review/README.md](review/README.md) and the
[proposal-editor example](examples/review.tsx).

## Scoped storage

Create stable service instances for each app/user scope:

| Factory | Default storage and integration |
| --- | --- |
| `createTutorialProgressStore({ namespace, storage? })` | Session storage; pass as `TutorialPlayer.progressStore` |
| `createTutorialCompletionStore({ namespace, storage? })` | Local storage; call `.mark(id, mode)` from the host's completion handler |
| `createTutorialContentTemplateStore({ namespace, storage? })` | Local storage; Studio `contentTemplates` |
| `createTutorialExportPreferences({ namespace, storage? })` | Local storage; Studio `exportPreferences` |
| `createTutorialExportPresetProfile(schema?, { namespace, storage? })` | Local storage; Studio `exportPresets` |
| `createDefaultTutorialDraftStore({ databaseName?, storeName? })` | IndexedDB in a browser, otherwise memory; share the selected store with Studio, stage and capture |
| `createReviewEnvironment({ namespace, ... })` | Separate reviewer/inbox stores; see the review contract |

Tutorial storage factories accept a lazy `() => Storage | null`. Without a
namespace, keys are `tourkit:<name>`; with one they are
`<namespace>:tutorial:<name>`. The full key list is in
[RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md#storage-and-wire-identifiers).
Progress and completion stores expose `.subscribe`, covering same-document
writes and relevant browser storage events. Session progress is tab-scoped;
completion can be shared across tabs through local storage. Action buses,
surface registries and tutorial-review step stores also have instance
factories. They do not remove the one-active-player-per-document limit.
Namespaces separate records; they provide no authentication or security
boundary.

## Styles and examples

Import the built `styles.css` once for the complete theme, utilities, preflight
and component CSS. A source consumer that already owns Tailwind v4 preflight can
instead import `ui/theme.css` after Tailwind, add the Tourkit source to
Tailwind's `@source` list and support CSS-module imports for shared controls.
Source player imports include Driver's CSS. The theme uses a `.dark` ancestor
for dark mode.

| Example | Build command | Output |
| --- | --- | --- |
| Small task list | `node tooling/build-example.mjs task-list` | `.tmp-tourkit-example` |
| Modal/dropdown workflow | `node tooling/build-example.mjs dialog-workflow` | `.tmp-tourkit-dialog-example` |
| Full Studio and stage | `node tooling/build-example.mjs studio` | `.tmp-tourkit-studio-example` |
| Warehouse/observatory libraries | `node tooling/build-example.mjs library` | `.tmp-tourkit-library-example` |
| Proposal review and inbox | `node tooling/build-example.mjs review` | `.tmp-tourkit-review-example` |

`npm run build:examples` builds all five. Serve an output directory over HTTP
to try it. `npm run build:site` builds every example into `site/<id>/` with a
landing page; that is what the Pages site deploys. Every example build checks
its actual input graph for application imports. Examples contain demonstration
data only.

## Static lesson validation

The validator accepts a manifest or draft and explicit host metadata:

```sh
npm run validate:lesson -- --input lesson.tutorial.json --host host.json \
  --format markdown --output output/lesson-validation.md
```

Required host fields are `actionIds` and `fixtureIds`. Optional fields are
`repeatedAnchorIds`, `initialSnapshot`, exact pre-step `stepSnapshots`,
`aliases` and `evidence: { checkedAt, fingerprint }`. The report distinguishes
schema and undeclared-action/fixture errors from warnings about repeated anchors
without context, already-satisfied checks, stale screenshots or
stale/unverifiable evidence. It reuses Tourkit's schema, outcome and freshness
implementations.

Exit codes are 0 when there are no errors, 1 for validation errors (also
warnings with `--fail-on-warnings`), and 2 for CLI, configuration or read
failures. Evidence age limits are opt-in through `--max-evidence-age-days`; a
fingerprint detects lesson changes, not authenticity. Static validation executes
no actions and proves no live DOM behavior, learner competency or document
appearance.

## Development

```sh
npm ci
npm run check          # source/CSS boundaries, pinned codec, TypeScript
npm test               # boundary and codec tooling tests, then Vitest
npm run build          # dist/: ESM, declarations, styles.css, build manifest
npm run build:examples # the five examples
npm run build:site     # examples plus landing page under site/
npx playwright install chromium
npm run test:browser   # Studio, library, review and native-capture acceptance
npm run capture -- --help
npm run validate:lesson -- --help
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium binary
instead. The browser tests serve their own local HTTP fixtures and need the
example builds. They are executable assertions about the examples, not a
substitute for checking your own host application. CI runs check, test,
example builds and browser tests on Node 22.

## Documentation

- [ADOPTING.md](ADOPTING.md): integrating Tourkit into a new host.
- [RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md): supported runtime boundaries,
  storage and wire identifiers, current limitations.
- [DESIGN.md](DESIGN.md): design decisions.
- [VERIFICATION.md](VERIFICATION.md): recorded verification and its limits.
- [library/README.md](library/README.md), [review/README.md](review/README.md),
  [examples/studio/README.md](examples/studio/README.md).
- [`guidance/integrate-tourkit`](guidance/integrate-tourkit/SKILL.md): an
  agent skill for action/state mapping, dialog cooperation, Studio/stage
  integration and browser acceptance. Copy it into your agent's skills
  directory (for example `.agents/skills/integrate-tourkit`). For a new host,
  begin with one real workflow, its fixture reset and the neutral DOM policy,
  then add the library, authoring, capture, sharing or review capabilities that
  host requires.

## Licence

MIT © Ahmad Jalil. See [LICENSE](LICENSE). The bundled json-url distribution
carries its own licence and notices under [vendor/json-url](vendor/json-url).
