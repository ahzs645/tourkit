# Neutral Studio reference application

This project workspace implements the full Studio parent/iframe lifecycle. It
uses the real editor, draft library, player, semantic recorder, capture runner,
share codec and exporters. Its application model is only a synthetic list of
projects, with no routes, catalogs, fixtures or domain imports from another host.

Build with `node tooling/build-example.mjs studio` (or `npm run build:examples`),
then serve `.tmp-tourkit-studio-example` with a static HTTP server. Open
`index.html` for the author workspace and `stage.html` for the application. Both
entry points resolve their sibling URLs from their current directory; they work
when mounted below a path such as `/nested/studio/`.

## Try the complete workflow

1. Create a tutorial from My tutorials. Settings offers an empty fixture and a
   fixture with one sample project already saved.
2. Choose **Recording options → Record actions only (no microphone)**.
3. In the stage, open **New project**, enter **Launch plan**, choose **High**
   priority, and save. Stop recording to get four editable steps.
4. Edit the step titles, instructions or outcome checks, save, and reload.
5. Select a later step to reset and replay the earlier operations. Watch and
   Try it previews use fresh fixtures and the same operations as the controls.
6. Use **Review screenshots → Capture missing** to replay the draft in an
   offscreen stage. Review those images and export an illustrated HTML or PDF
   guide. Editable draft exports retain the screenshots.
7. Export/import a draft file, or share Watch, Try it and Edit a copy links.
   Links contain the lesson but omit media; a recipient needs the same running
   example application and can use a new browser without the author's database.

## Integration map

| User operation | Semantic action | Anchor | Snapshot outcome |
| --- | --- | --- | --- |
| Open dialog | `projects.open-create` | `projects.add` | `surfaces.create.open` becomes true |
| Commit name | `projects.set-name` | `projects.name` | `draft.name` matches the entered name |
| Choose priority | `projects.set-priority` | `projects.priority` | `draft.priority` matches the selection |
| Save | `projects.save` | `projects.save` | A new matching item exists in `projects` |
| Close dialog | `projects.close-create` | `projects.close` | `surfaces.create.open` becomes false |

Name changes update the application immediately and emit one semantic event
when the field is committed on blur or submit. This prevents every keystroke
from becoming an authored step. Reopening the modal restores its retained draft;
resetting the fixture restores the original sample data instead. Reset resolves
after the new snapshot and DOM have committed, which makes seek deterministic.

`integration.ts` owns routes, the explicit share-route allowlist and a named
IndexedDB draft store shared across frames. `environment.ts` supplies Studio
metadata, suggested checks, capture URLs and view policies. `stage.tsx` loads
draft/shared manifests and selects authoring, capture or learner playback while
leaving the application's real UI mounted. `main.tsx` supplies history navigation
to the controlled `TutorialWorkspace`; the reusable shell has no router import.

`project-dom-policy.ts` explicitly selects the neutral ARIA/native-dialog policy
and identifies the project's own dialog-opening outcome. The player, overlay,
anchor resolver and capture runner receive that policy. The kit's default keeps
the legacy `.pb-window` floating-window and `surfaces.*` behavior for compatibility;
another host can supply its own selectors and snapshot predicate per player.

The project example is same-origin, uses one active player per stage document,
and keeps all application data temporary. Offline interactive application export
is unavailable because the example does not provide an offline runtime bundle.
Static document exports work through the standard kit exporters.

## Executable acceptance

After building, run:

```sh
node --test tooling/studio-browser.test.mjs
```

The test serves the build at `/nested/studio/`, records real controls, inspects
persisted semantic steps/checks, edits and reloads, seeks, completes both preview
modes, restarts Watch, captures four screenshots with fingerprints, inspects an
actual HTML export, round-trips a draft file, and plays/imports a shared link in
a fresh browser context at a narrow viewport. It writes screenshots and exports
to a temporary artifact directory printed in the result. Use
`TUTORIAL_STUDIO_BUILD_DIR` and `TUTORIAL_STUDIO_ARTIFACT_DIR` to choose the build
and evidence directories; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is an optional
browser override. Failures are assertions, not silent skips.
