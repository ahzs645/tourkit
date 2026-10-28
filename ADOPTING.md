# Adopting Tourkit in a host application

This guide covers what a new host provides when it adopts Tourkit: the
dependency arrangement, styles and fonts, the share codec, native screenshot
capture of the host, and validation evidence. Use [README.md](README.md) for
the APIs, [RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md) for runtime policy and
[VERIFICATION.md](VERIFICATION.md) for the recorded verification. The
[integration skill](guidance/integrate-tourkit/SKILL.md) turns this into a
step-by-step procedure with acceptance checks.

## Choose a consumption mode

| Mode | What you import | Who installs dependencies |
| --- | --- | --- |
| `npm install github:ahzs645/tourkit` | Built subpaths such as `tourkit/player` and `tourkit/styles.css` | npm, from Tourkit's `package.json`; `prepare` builds `dist/` on install |
| Git submodule, compiled from source | Source directories such as `modules/tourkit/player` | The host, which lists Tourkit's runtime dependencies in its own `package.json` |

With the built package, `npm run build` has already checked the source and the
bundled input graph. It writes twelve ESM entrypoints, declaration files,
combined `dist/styles.css`, shared chunks and `dist/build-manifest.json`.
Dependencies remain external imports, so the output is consumed through an
application bundler, not served directly as dependency-free browser scripts.
Keep everything under `dist` together; an entrypoint without its shared chunks
does not load.

With a submodule, never run `npm install` inside the Tourkit directory: the
bundler would resolve a second React from it and hooks would break. Keep the
host's versions of Tourkit's runtime dependencies compatible with those in
Tourkit's `package.json` and lockfile. The bundler must compile TypeScript/TSX
and handle plain and module CSS imports.

Either way the unit is one package with `core`, `player`, `recording`,
`export`, `studio`, `ui`, `library`, `review`, `share`, `session`, `capture`
and `validation` subpaths, plus the stylesheet. There is no all-in-one
entrypoint, and the directories do not promise independent versioning.

## What the host owns

| Capability | Tourkit implementation | Host responsibility |
| --- | --- | --- |
| Playback and core | `core/`, `player/` | Actions, observable snapshot, anchor attributes, fixture/reset and navigation policy |
| Published lesson browsing | `library/` | Catalog/order, section IDs, routes/tabs, optional menus and storage scope |
| Authoring workspace | `studio/TutorialWorkspace.tsx`, Studio environment, `session` | Router/history, stage URL, stage instrumentation and compatible draft storage |
| Recording and screenshot replay | `recording/`, `capture` | Semantic events, check suggestions, launch/crop policy and stage readiness |
| Review addon | `review/` | Subject/part mapping, labels, scope and optional tutorial/Studio composition |
| Guide exports and sharing | `export/`, `share.ts` | Optional fonts, permitted launch routes and any offline application bundle |
| Native capture | `tooling/capture-native.mjs` | A running same-origin stage using the same draft-store and protocol contract |
| Lesson validation | `tooling/validate-lesson.ts` and CLI | Declared actions/fixtures, optional snapshots and dated evidence |
| Persistence | Store and environment factories | A stable app/user namespace or explicit storage instance |

The [examples](examples) exercise these contracts without any production host:
the library example's warehouse and observatory collections deliberately reuse
lesson IDs with independent stores, the Studio example authors a
project-creation workflow, and the review example annotates a proposal
document. Start from the closest one.

## Styles and fonts

The built stylesheet includes the Tailwind theme, utilities and preflight, and
component CSS. Import it once. For source adoption into a Tailwind v4 app that
already owns preflight, import `ui/theme.css`, add Tourkit to Tailwind's
`@source` list and support the source CSS imports and CSS modules instead.
Check light/dark mode and dialog/dropdown focus in the consuming app, because
its CSS and portal behavior still matter.

PDF exports embed Roboto from pdfmake by default. The optional Liberation Sans
font is supplied explicitly as four URLs through
`TutorialExportRuntime.pdfFonts`:

```ts
const exportRuntime = {
  pdfFonts: {
    LiberationSans: {
      normal: new URL("fonts/LiberationSans-Regular.ttf", assetBase).href,
      bold: new URL("fonts/LiberationSans-Bold.ttf", assetBase).href,
      italics: new URL("fonts/LiberationSans-Italic.ttf", assetBase).href,
      bolditalics: new URL("fonts/LiberationSans-BoldItalic.ttf", assetBase).href,
    },
  },
};
```

The host defines `assetBase`, serves the files and carries their licence
(including `LICENSE_LIBERATION` when using the Liberation distribution).
Relative deployment paths must resolve to the actual assets. The renderer
reports configuration and fetch failures; it assumes no PDF viewer or other
asset directory in the host.

## Share codec

Sharing imports the checked-in browser distribution under `vendor/json-url`.
Its provenance records the upstream revision, dependencies and hash; its
licence and notices travel with Tourkit, and `npm run check` verifies the
pinned artifact. Only a deliberate codec refresh uses
`tooling/build-share-codec.mjs`; installation and builds need no upstream
checkout. Keep the golden `t1` token tests passing when updating it, because a
new compression format breaks existing links.

The codec's allowlist (`allowedLaunchPaths`, `allowedHashKeys`) is the host's
policy. A default codec permits only `/`.

## Native capture of another host

A capture input is either a portable draft (`--draft`) or a manifest
(`--manifest`). The runner validates or converts it and creates an isolated
replay draft. The host must load that draft from the configured IndexedDB
database/store and mount `TutorialCaptureRun` when the capture URL is
selected. The wrapper page and stage must have the same origin.

```sh
npm run capture -- --draft lesson.tutorial-draft.json \
  --base-url http://localhost:3000 \
  --launch-url http://localhost:3000/training/stage.html \
  --database project-tutorials --store drafts \
  --region-selector '[data-capture-region]' --out output/project-lesson
```

`--launch-url` overrides the stage route while preserving capture parameters.
The default database/store are `tourkit-studio` / `drafts`. The default
viewport is 1920 × 1080; `--viewport` captures all of it, otherwise capture
uses the configured region or fallback bounds with `--margin` (default 16
pixels). `--channel chrome` selects an installed browser channel;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is another option.

Programmatic callers import `captureNativeTutorial` or `runNativeCaptureCli`
from `tooling/capture-native.mjs`. A host wrapper can supply
`resolveLaunchUrl`, `bootstrapDraft`, a bundled `boundsScript`, or a catalog
`resolveTutorial` through the runner options; CLI flags override wrapper
defaults. The generic runner loads no application catalog, so `--tutorial <id>`
works only through such a wrapper.

The bounds adapter is bundled before browser injection. Serializing a wrapper
with `Function#toString()` would lose its imported dependencies; the
fresh-browser helper test protects that boundary. Each screenshot carries native
provenance and a step fingerprint, and the capture report records it as
visually unreviewed. Inspect the images and document layout separately from
replay success.

## Validation and evidence

Provide host metadata explicitly, for example:

```json
{
  "actionIds": ["projects.open-create", "projects.set-name", "projects.save"],
  "fixtureIds": ["empty-projects"],
  "repeatedAnchorIds": ["projects.save"],
  "initialSnapshot": { "projects": [] }
}
```

`validateTutorialLesson` (the `validation` subpath, or `npm run
validate:lesson`) accepts this metadata and a manifest or draft and returns a
typed report. Exact `stepSnapshots` can describe the state before individual
steps; without them, the optional initial snapshot is only a fixture-level
check. No action effects are guessed. The validator reuses schema validation,
outcome evaluation, draft conversion and screenshot freshness rather than a
parallel evaluator.

Errors cover schema violations and undeclared actions/fixtures. Warnings cover
already-satisfied outcomes, repeated anchors without context, missing or stale
screenshot provenance and stale or unverifiable evidence. A reading-only draft
can be a valid guide without being a playable manifest. Optional
`evidence.checkedAt` and `evidence.fingerprint` bind prior evidence to the
lesson; `--max-evidence-age-days` applies an explicit freshness policy.

A static pass establishes these declared contracts. Browser tests must
establish anchor identity, action effects, Practice/Watch completion,
reset/seek behavior and export appearance in the host itself.

## Data from earlier versions

Tourkit's storage keys, iframe and capture protocols, CSS names and review file
format are listed in
[RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md#storage-and-wire-identifiers). Review
files written in the pre-release `webforms-review-feedback` format are still
read. Browser storage written under other keys is not; a host that has such
data migrates it itself, for example by copying the old keys to the new ones at
startup, or keeps it by passing the review factories its own key functions.

## Decisions that remain with the host

- Version changes to manifest tracks, view vocabulary, or wire/storage
  identifiers need compatibility readers and migration tests. Library sections
  already permit independent curriculum categories.
- Cross-origin Studio, Shadow DOM, native top-layer overlays, multiple active
  players in one document and an arbitrary host's offline bundle are not
  supported; add and prove support before relying on them.
- Account switching, cleanup, retention and any server-backed persistence are
  host-owned. Browser namespaces separate records; they are not access control.

The examples and the integration skill's acceptance checks are the starting
point for a new host. A passing Tourkit suite does not certify the host's own
workflows; record your own browser evidence.
