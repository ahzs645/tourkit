# Learner library, scope and optional review

## Learner collections

Use `TutorialLibrarySection[]` with application-owned `id`, `title`, optional
`description` and `tutorials`. Section IDs are independent of the finite v1
manifest track enum. `TutorialLibrary` renders search, kind/status filters,
cards or compact rows, section navigation, progress and a suggested next lesson.
The host supplies navigation, launch callbacks/URLs, fixture links and menu
slots. `tutorialLibraryExportGroups(sections)` adapts the same collections for
bulk export; the library does not import the export UI.

Create a stable `createTutorialLibraryStatusSource` from the selected scope's
completion reader, progress reader and subscriptions. Subscribe to both
stores, including same-document writes. The source keys snapshots by actual
ordered lesson IDs, not list length. A completed lesson takes priority over
retained interrupted progress. See `examples/library.tsx` for two independent
collections that deliberately reuse lesson IDs and both run the real player.

## Persistence and lifecycle

| Concern | API / wiring |
| --- | --- |
| Practice resume and aliases | `createTutorialProgressStore({ namespace, storage? })`; pass `progressStore` to the player |
| Completion and library counts | `createTutorialCompletionStore({ namespace, storage? })`; mark in the host completion callback |
| Export preferences | `createTutorialExportPreferences({ namespace, storage? })`; set Studio `exportPreferences` |
| Named export presets | `createTutorialExportPresetProfile(optionsSchema, { namespace, storage? })`; set `exportPresets` |
| Reusable content blocks | `createTutorialContentTemplateStore({ namespace, storage? })`; set `contentTemplates` |
| Drafts across frames | `IndexedDbTutorialDraftStore(databaseName, storeName)` with matching names in parent and child |
| Semantic actions | Stable bus/registry shared by UI and `TutorialSessionIntegration.actionBus` |
| Reported surfaces | `createTutorialSurfaceRegistry()`; pass the registry to participating reporters |

The optional `storage` function returns a `Storage` object or `null`. Without
a namespace the store factories use shared `tourkit:<name>` keys; with one they
use `<namespace>:tutorial:<name>`, escaping the namespace first. They separate records;
they are not authorization or a security boundary. Do not store private user
records in tutorial snapshots or recordings.

Keep these objects stable for a run. Changing `progressStore` restarts the
player's run state and aborts its old asynchronous work before it can commit
aliases/progress to the new scope. The host remains responsible for switching
its own fixture, action executors, completion callbacks and review environment
on account changes. Separate scopes do not imply that several players can
control one document concurrently.

## Optional review addon

Import `review` only when review tools are requested. Create one stable
`createReviewEnvironment({ namespace, storage?, labels?, ... })` and provide it
through `<ReviewEnvironmentProvider value={environment}>`. Use its storage and
inbox together. The engine, player and ordinary Studio do not require this
addon; Studio accepts an optional review Host through its environment.

Generic review surfaces carry stable subject/part IDs and fingerprints. The
addon supplies pinned comments, drawings, snapshots, attachments, replies,
rounds, resolve/reopen, portable files and an inbox. The application supplies
subject vocabulary, routes and changed-content navigation. `examples/review.tsx`
uses an unrelated document with paragraphs. Keep the host's review adapters in
the host. Feedback files in the pre-release `webforms-review-feedback` format
are still read; new files are written as `tourkit-review-feedback`. Confirm that imported feedback matches the actual subject before
merging, and only navigate to allowed HTTP(S) continuation URLs.

## Package, entrypoints and codec

The package is `tourkit`, installed from `github:ahzs645/tourkit` (its
`prepare` script builds `dist/`) or consumed from source as a Git submodule.
It is not on the npm registry. Its public subpaths are `core`, `player`,
`recording`, `export`, `studio`, `ui`, `library`, `review`, `share`, `session`,
`capture`, `validation` and `styles.css`. Use the generated declaration files
for exact APIs. Core can load without React or browser globals. React UI and
capture need the runtime described in `RUNTIME_SUPPORT.md`.

Installation and builds use the checked-in, pinned share codec and its
licence/provenance checks; nothing is fetched. The supported `t1` codec set and
golden tokens keep existing shared links working. Refresh the vendor only
through `tooling/build-share-codec.mjs` and verify all compatibility fixtures.
Do not add unneeded codecs or delete licence notices.

Keep application lesson packs, fixtures, domain vocabulary and routes in the
consuming application. Storage keys and wire identifiers are listed in
`RUNTIME_SUPPORT.md`; migrating data the host wrote under other keys is the
host's job.
