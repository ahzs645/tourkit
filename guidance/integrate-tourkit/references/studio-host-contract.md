# Studio and application-stage contract

Contents: [entry points](#two-entry-points), [Studio setup](#configure-the-studio),
[stage runtime](#wire-the-application-stage), [semantic recording](#record-real-actions),
[views](#separate-outcomes-from-view-context), [capture and exports](#capture-sharing-and-exports).

## Two entry points

Full adoption requires both a Studio/library page and a real application stage
page. The Studio embeds that stage. Its environment supplies metadata and
services; it does not implement the application's UI, fixture loading, command
handlers or iframe runtime.

Read `studio/environment.tsx`, `studio/tutorial-studio.tsx`,
`components/tutorial-session.ts`, `components/tutorial-capture-run.tsx` and
`recording/capture-all.ts` in the located Tourkit checkout before wiring these
pieces.
Use `examples/studio/` for the complete neutral project-management host. Its
parent and stage run from static `.html` routes beneath an arbitrary base path.
`TutorialWorkspace` composes My tutorials and the editor while the application
owns history through `openDraftId` and `onOpenDraft`.

Keep stages same-origin and embeddable. Studio and capture inspect
`iframe.contentDocument`, and the child bridge validates/sends the current
origin. A controller `targetOrigin` option alone cannot make this whole
workflow cross-origin. The embedded page loads its own application styles.

## Configure the Studio

Use stable module-level or memoized adapters. Start with
`DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT`; leave unused catalogs/review tools empty.
The following is a configuration pattern. `resolvePath` is the host's real
deployment-path resolver and `inferAnchor`/view/suggestion functions are host
code, not additional Tourkit exports.

```tsx
const createDraftStore = () =>
  new IndexedDbTutorialDraftStore("my-app-tutorials", "drafts");

const shareCodec = createTutorialShareCodec({
  allowedLaunchPaths: () => new Set(["/learn/demo/"]),
  allowedHashKeys: ["tab"],
});

const createDraft = () => createTutorialRecordingDraft({
  title: "New application tutorial",
  path: "/learn/demo/",
  fixture: "empty-demo",
  hash: { tutorialAuthor: 1 },
});

const environment: TutorialStudioEnvironment = {
  ...DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT,
  defaultStageLabel: "My application",
  studioPath: "/learn/studio/",
  resolvePath,
  createDraft,
  createDraftStore,
  shareCodec,
  inferAnchor,
  suggestions,
  viewContext,
  resolveContextActions,
  actionChangesView,
  defaultSnapshotPaths: ["projects", "surfaces.editor.open"],
  canSeek: () => false,
  captureRuntime: {
    resolveLaunchUrl: (launch) => resolvePath(buildTutorialLaunchUrl(launch)),
  },
};

<TutorialStudioEnvironmentProvider environment={environment}>
  <TutorialStudio sourceUrl={(draft) =>
    resolvePath(buildTutorialLaunchUrl(draft.launch))} />
</TutorialStudioEnvironmentProvider>
```

Import Studio types/components from `studio`, draft/store APIs from `recording`,
launch helpers from `core`, and codec creation from `share`. Adapt the import
prefix to the actual located source/package.

Key requirements:

- Include `tutorialAuthor: 1` in fresh authoring drafts. The generic recording
  draft factory does not insert it automatically. Studio uses `createDraft`
  unless an explicit `initialDraft` or `createInitialDraft` is supplied.
- Use a **function** for `sourceUrl` when applying a base path. It participates
  in authoring and preview URLs. `environment.resolvePath` alone does not
  transform the authoring iframe's URL; a static `sourceUrl` is not a complete
  preview routing strategy. Apply the prefix exactly once.
- Use the same persistent store in Studio, `MyTutorials`, draft playback and
  capture. Separate iframe realms cannot share a `MemoryTutorialDraftStore`.
  Matching IndexedDB database/store names work across same-origin frames.
- The export runner obtains capture storage from `captureRuntime.draftStore`
  or `createDraftStore`. If calling capture directly, pass the same store.
- Render the editor at `studioPath`; the library opens saved drafts using
  `?open=<id>`. Studio reads this query parameter.
- For multiple stages, also supply stage descriptors, fixture lists,
  `getStage`, `stageOfLaunch`, `launchForStage` and preferred-stage storage.
  Implement each advertised fixture in the actual application route.
- Enable `canSeek` only after implementing an awaitable fixture reset in the
  stage. Reset must finish state/resource/executor initialization, not merely
  schedule a React state update.

## Wire the application stage

Create a separate stable `TutorialSessionIntegration`, sharing the parent's
store, codec and view callbacks. It need not import the Studio UI/provider.

```ts
const sessionIntegration = {
  ...DEFAULT_TUTORIAL_SESSION_INTEGRATION,
  createDraftStore,
  decodeTutorialShare: shareCodec.decodeTutorialShare,
  viewContext,
  resolveContextActions,
  actionChangesView,
};
```

Use this sequence in the stage component:

1. Read `{ locationState, runKey }` with `useTutorialLocation()`.
2. Call `useTutorialDraftManifest(tutorialId, runKey, sessionIntegration)` for
   `draft:` and `link:` launches. Load ordinary IDs from the host's catalog.
3. Load the named fixture and expose fresh `state`, an action executor and
   actual readiness. Restart the fixture for a new run, not only the player.
4. Mount `useTutorialAuthoringBridge(authoring, state, execute, ready, reset,
   sessionIntegration)` unconditionally as a hook in this stage.
5. Once ready, choose authoring, capture or normal playback. The existing
   application UI remains mounted in each mode.

The following is the render decision, not a complete application component:

```tsx
const { locationState, runKey } = useTutorialLocation();
const draftManifest = useTutorialDraftManifest(
  locationState.tutorialId, runKey, sessionIntegration,
);
const manifest = catalogManifest ?? draftManifest;
// The bridge calls with action only; player and capture also provide context.
const execute = async (
  action: TutorialSemanticAction,
  context?: TutorialExecutionContext,
) => (await registry.execute(action, context?.signal)).result;
useTutorialAuthoringBridge(
  locationState.authoring, state, execute, ready, resetFixture,
  sessionIntegration,
);

const startIndex = manifest ? Math.max(0,
  flattenTutorialSteps(manifest).findIndex(
    ({ step }) => step.id === locationState.startStep,
  )) : 0;

// Render alongside the host's actual interface:
ready && manifest && !locationState.authoring && (
  locationState.capture ? <TutorialCaptureRun
    key={`${manifest.id}:${runKey}`}
    manifest={manifest} token={locationState.capture}
    before={locationState.captureBefore}
    execute={execute} state={state}
    resolveContextActions={resolveContextActions}
  /> : <TutorialPlayer
    key={`${manifest.id}:${locationState.mode}:${runKey}`}
    manifest={manifest} state={state}
    mode={locationState.mode} spotlightStyle={locationState.spotlightStyle}
    startAt={startIndex} catchUp={startIndex > 0}
    persistProgress={!locationState.run}
    onExecuteAction={execute} resolveContextActions={resolveContextActions}
    onComplete={finishRun} onStop={finishRun}
  />
)
```

`catalogManifest`, `state`, `ready`, `registry`, `resetFixture` and `finishRun`
are host responsibilities. Import session hooks from the `session` public
entrypoint and the capture runner from `capture` (or their located source files), and
player APIs and `TutorialExecutionContext` from `player`; import
`TutorialSemanticAction` from `core`. In a real component, memoize the executor
for its registry. In `finishRun`, update host run state/unmount as
appropriate and use `forgetTutorialRun()` to remove run parameters without
reloading the user's finished work. That helper deliberately does not emit a
hashchange event.

`tutorialStep` is a step ID; map it to an index before passing `startAt`.
`tutorialRun` requests a fresh run, including Studio previews; do not restore
stale progress for it. Capture is a separate runner without learner controls,
narration or progress/completion writes. It has no `ready` prop: gate mounting.
Published capture manifests strip the authoring flag automatically.

## Record real actions

Set `sessionIntegration.actionBus` to the same scoped bus used by the stage's
UI and registry. Omission preserves the shared `tutorialActionBus`. A separate
`subscribeToActions` passed to the player does not replace this child bus.
Observe real UI handlers once, register replay operations
against the same domain logic, and return operation results rather than registry
event envelopes. See the player reference for that adapter.

Map recorded action IDs to actual DOM anchors with `inferAnchor`. Add a
`TutorialCheckSuggestionProvider` when automatic outcome checks are desired:
`forLaunch(launch)` returns an independent `{ suggest(action), apply(action) }`
projection session. Without it actions still record/replay, but Tourkit
deliberately invents no host-specific checks. Authors can add checks manually.

## Separate outcomes from view context

Checks read arbitrary valid dotted paths in the full host snapshot. The bridge
sends only the v1 structural view projection. `viewContext` receives a **flat**
`TutorialViewState`, such as `{ "host.page": "projects", "host.dialog": null }`.
The player's state may be nested, e.g. `{ projects, host: { page, dialog } }`.

Allowed context keys are `workspace.activeTab` and
`host.{emulator,module,node,view,tab,page,menu,browserTab,dialog}`. Map the host's
screens to those structural keys or make a deliberate versioned schema change.
Do not use an invented `app.route` context key while keeping v1 validation.

Use the same `resolveContextActions` in Studio, session integration, player
and capture. Restore navigation/surface context there; leave replay of mutating
earlier steps to seek/catch-up. Classify navigation and modal actions with
`actionChangesView` so a recording does not pin navigation to the wrong prior view.

## Capture, sharing and exports

The parent capture service opens an offscreen stage, stores a temporary draft,
and waits for step/screenshot acknowledgements from `TutorialCaptureRun`. Both
ends must use the same session loader and persistent store. Supply
`captureRuntime.resolveLaunchUrl` for deployment paths and optionally
`captureInterface` for region framing. The neutral capture covers the viewport.
Observe cleanup and errors; never treat a timeout as a completed screenshot.

Keep share routes/hash keys explicitly allowed by the consumer's codec. Share
links omit screenshots and blob narration; use draft/file exports when media
must travel. A default codec only permits `/`.

Static guide renderers can use text and already-supplied screenshots without
an application runtime. The Studio export runner defaults to including
screenshots and replays an iframe to capture missing images: disable screenshot
capture or supply the images when no runnable stage is available. Supply
font/asset URLs and metadata/preferences where needed. Offline interactive HTML requires a real
`exportRuntime.interactive` provider that bundles the target application and
supports its actions/fixtures. Adding the player does not provide that bundle.

Roboto is bundled for PDF output. To offer Liberation Sans, explicitly provide
all four font URLs under `exportRuntime.pdfFonts.LiberationSans`; verify every
asset is reachable beneath the actual deployment base path. No PDF.js vendor
route is assumed by Tourkit. Use `createTutorialExportPreferences`, a scoped
`createTutorialExportPresetProfile`, and `environment.contentTemplates` for
independent preferences and reusable content blocks.

For native Chromium screenshots, run `npm run capture -- --manifest` (or
`--draft`) from a Tourkit checkout, or `tooling/capture-native.mjs` directly,
with the actual base URL, stage URL and IndexedDB database/store.
The application wrapper may provide a catalog resolver, storage bootstrap or
bundled crop adapter. A capture report starts with `visuallyReviewed: false`;
inspect the actual images before distributing a guide. The validator can flag
stale screenshots and evidence but cannot perform that visual review.

Verify the full path in a browser: record a modal workflow, inspect generated
steps, save/reload, preview Watch/Practice, reset and seek if offered, capture
screenshots and inspect an actual exported file. Report any unimplemented
capability explicitly.

