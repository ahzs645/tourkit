# Verification record

This is a dated record of what was verified, how, and with what limits. Newest
entries first. It covers Tourkit and its examples; it does not certify any host
application's lessons or workflows. A host records its own evidence.

## 2026-10-30: Chrome recorder and captured-website authoring

Verified on Linux with Node 24.22.1 and official Chrome for Testing
153.0.8010.0. The implementation is based on repository commit
`37496441f28052737ccac7f110fbd8932ff42f93`, with rrweb record/replay 2.2.0 pinned
in the lockfile.

| Check | Result |
| --- | --- |
| `npm run check` | Passed: source boundaries, pinned codec and full TypeScript |
| `npm test` | Passed: 9 Node tooling tests and 358 Vitest tests across 67 files |
| `npm run build` | Passed: 16 public entries, declarations and styles |
| Build from a copied `node_modules/tourkit` path | Passed; retains the pnpm declaration regression gate |
| `npm run build:examples` | Passed: six application examples |
| `npm run build:site` | Passed: seven destinations including Capture Studio |
| Standalone Studio and extension builds | Passed; recorder ZIP generated from the tested build |
| `npm run test:browser` | All 7 existing browser acceptance tests passed |
| `npm run test:capture:browser` | Both new DOM/runtime and Studio acceptance tests passed |
| `npm run test:extension:browser` | Real Manifest V3 extension acceptance passed |
| `npm audit --audit-level=high` | Zero vulnerabilities reported |

### What the new browser checks prove

- The actual extension records a local simulated-service workflow: create,
  save, reopen and edit a project, then pause/resume and reload into a new
  document segment. Its native screenshot contains the expected solid private
  mask pixels; private form values, private image bytes and query secrets do not
  appear in the exported capture. The service demo sends no `/api/` HTTP requests.
- Terminating the extension service worker does not lose acknowledged events.
  The dashboard opens the recording in its bundled Studio, which reconstructs
  real DOM. Computed background and font values match the source stylesheet.
  Edited metadata survives package export.
- Studio edits instructions, reorders/deletes steps, repairs a target, changes
  captured text, replaces/reviews a screenshot, recovers saved edits after reload
  and reimports the resulting `.tourkit` package. The existing application Studio
  exercises the same import and interactive-export path under a nested URL.
- Standalone HTML opens through `file://`, makes no HTTP requests, accepts click
  and input interactions, preserves learner input across checkpoints and the
  final result, and resets successfully. Desktop and phone editor layouts were
  visually inspected; the 390-pixel layout has no horizontal page overflow.
- Adversarial HTML, frame content, inline handlers, CSS escape sequences and
  style mutations neither execute source scripts nor issue source-origin
  request events. Runtime checks also cover target picking, scaled geometry,
  stale document targets and final-action completion.

Visual inspection caught a real fidelity issue: rrweb can store an inline
stylesheet in a link's `_cssText` attribute without `href` or `rel`. The importer
now preserves that as sanitized style content, and both unit and browser tests
assert this behavior. Privacy review also added pre-persistence removal of raw
`srcdoc`, token-aware CSS URL handling and private-resource pruning.

**Limits.** Extension automation uses a disposable manifest with screenshot
permission because Playwright cannot activate Chrome's toolbar `activeTab`
grant. The test separately asserts the shipped manifest has only `activeTab`,
`scripting`, `storage` and `downloads`, with no required host grants. Manual
toolbar interaction, store review and broad representative-site compatibility
were not tested. These checks establish a captured-state tutorial workflow and
an explicit demo service adapter, not a universal clone of arbitrary JavaScript,
backend logic, opaque frames or WebGL applications.

## 2026-10-29: product-tour options and the RenderCV migration

Verified on Linux with Node 22 in a fresh checkout, then in RenderCV
(`ahzs645/rendercv-app`), whose driver.js onboarding tour was moved onto
Tourkit's player with a host-drawn card. Chromium came from the environment's
Playwright install (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).

| Command | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm test` | Passed: 9 Node tooling tests and 321 Vitest tests, including the new `player/tour-presentation.test.tsx` |
| `npm run build` | Passed |
| `npm run build:examples` and `npm run test:browser` | 7 browser acceptance tests passed (run before `renderCard` and the alignment changes, which do not touch the examples' default card) |

The new tests cover prepare actions on entry and on Back, localised labels,
the Skip button, keyboard navigation inside and outside fields, a host-drawn
card, the Studio draft round trip of `prepare` and `align`, the validator's
check of prepare action IDs, and a control that slides into view on a
transform. That last test fails without the player's transition re-check.

In RenderCV, at desktop (1280 × 800 and 1440 × 900) and phone (390 × 844)
sizes, every step was played with Next, the arrow keys, Back, Skip, the close
control, Escape and a restart from the sidebar. Completion and skip each
recorded the onboarding preference; there were no page errors.
The old and new tours ran side by side from the same commit's worktree. The
card's bounding boxes and computed type matched to within 1 px on every part,
and the arrow to within 4 px. RenderCV's typecheck, 159 tests and production
build passed. The bundle contains none of Tourkit's export libraries.

RenderCV's first CI run after the merge failed at install: pnpm built Tourkit
inside `/home/runner/setup-pnpm/node_modules/.bin/store/…`, and declaration
emit there rejected four components' inferred return types (TS2883). Reproduced
by building a copy under a `node_modules` path with its own `npm ci`. That
failed with the same four errors, then built cleanly once their return types
were declared. A RenderCV install with its pnpm store under `node_modules`
then succeeded too.

**Limits.** One existing test, *portable validator CLI › writes JSON/Markdown
reports…*, intermittently passes its 5 s timeout when the whole suite runs
on a loaded machine. It fails the same way on the 0.1.0 commit, and passes when
run alone. Only English and Korean labels were exercised in RenderCV. Dark
mode was not compared against the original.

## 2026-10-28: standalone Tourkit checkout

Verified in a fresh checkout of the Tourkit repository, outside any host
application, on macOS with Node 22 or later. Dependencies came only from the
repository's own `package.json` and `package-lock.json`.

| Command | Result |
| --- | --- |
| `npm ci` | Passed |
| `npm run check` | Passed: source/CSS boundaries, pinned codec, TypeScript |
| `npm test` | All tests passed: the Node boundary and codec tooling tests, then the Vitest suite |
| `npm run build` | Passed: 12 ESM entrypoints, declarations and `styles.css` |
| `npm run build:examples` | Passed: all five examples, no application imports |
| `npm run test:browser` | 7 browser acceptance tests passed |

The share-codec rebuild test failed on macOS before this run. `tmpdir()` there
is behind a `/var` → `/private/var` symlink, while esbuild reports real paths,
so the staged inputs did not match. `tooling/build-share-codec.mjs` now resolves
the staging directory with `realpath` first; the test passes.

This entry also records the move to the public repository: the package is
named `tourkit` (MIT), its manifest and lockfile live at the repository root,
`prepare` builds `dist/` on a Git install, `npm run build:site` builds the
Pages site, and storage keys, protocols, CSS names and the review file format
use `tourkit` identifiers (see
[RUNTIME_SUPPORT.md](RUNTIME_SUPPORT.md#storage-and-wire-identifiers)).

## 2026-10-26: independent project acceptance

Tourkit was copied to a new directory outside its original host application and
installed with its own lockfile and `npm ci`, with no source aliases, symlinked
dependencies or private submodules. Installation uses the checked-in share-codec
distribution and verifies its provenance without downloading upstream source.

| Check | Result |
| --- | --- |
| Fresh locked installation | Passed; 169 installed packages on this platform |
| Source/CSS dependency boundary and pinned vendor checks | Passed |
| Alias-free TypeScript | Passed |
| Vitest suite | 59 files, 312 tests passed |
| Boundary and reproducible codec tooling | 9 tests passed: 4 boundary, 5 codec build/integrity cases |
| Dependency audit | Zero vulnerabilities across all severities |
| Package build | 12 ESM entrypoints, declarations and compiled theme/component CSS produced |
| Task-list example build | 55 Tourkit inputs, no application imports |
| Dialog example build | 55 Tourkit inputs, no application imports |
| Full Studio example build | 120 Tourkit inputs, no application imports |
| Learner-library example build | 49 Tourkit inputs, no application imports |
| Optional review example build | 31 Tourkit inputs, no application imports |

The build restores `"use client"` at React entrypoints and emits explicit
relative `.js`/`index.js` declaration specifiers for ESM consumers. The package
contract was checked through its declared exports rather than by importing the
source: all 12 runtime/type targets, the shared stylesheet and stock library
menus; strict Bundler and NodeNext type resolution; core loading in plain Node;
and a browser bundle using the built player, library and Studio exports.

Local tools were Node 24.22.1, TypeScript 6.0.3, React 19.3.0, Playwright 1.63.0
and Chromium 138.0.7204.0. The install pins Zod 4.6.6, Happy DOM 21.0.4, Vite
8.3.5, Vitest 5.0.5 and the `image-size` override at 2.0.3; versions and
integrity values come from the lockfile. These runs do not establish a broad
cross-browser or older-React support matrix.

### Browser workflows

| Example | Verified behavior |
| --- | --- |
| Full Studio | Switch both fixtures; record four actual modal operations; edit checks; save/reload; wait for live anchors; seek; Watch; restart with fixture reset; finish Practice; capture four images with fingerprints; export illustrated HTML and editable JSON; import with Keep both; open a shared lesson in a fresh narrow dark context; import an editable copy |
| Learner library | Search, type/status filters, cards/rows, Watch completion, interrupted Practice, reload/resume with state reconstruction, live/cross-tab status changes, independent collections using the same lesson IDs, narrow dark layout |
| Optional review | At 1280 and 390 pixels: pin a comment, reply, resolve/reopen, draw, capture a snapshot, export/reimport in a fresh context, and open changed-content feedback from the inbox |
| Native capture | Use a manifest with omitted schema defaults and wrapper-supplied routes/storage; capture four real 1920 × 1080 images from the neutral stage; verify embedded provenance and editable round-trip; produce HTML, DOCX and a real PDF |
| Static native guide | Export a guide-only block retaining automatic screenshot mode without requiring a running application stage |

Studio, library and review acceptance explicitly asserted no browser runtime
errors. Desktop/narrow Studio, library and review screenshots were inspected.
Native capture reports deliberately retain `visuallyReviewed: false`; passing
capture/export tests does not approve images for a production guide.

The independent copy exposed a review-test path that assumed the original
host's directory layout. The runner now resolves its default build relative to
the invoking project, like the example builder, and both review viewport
scenarios passed afterwards. Declaration consumer testing separately exposed
and corrected extensionless ESM type imports.

### Compatibility and failure checks

The tests include fixed upstream `t1` tokens for all six supported share
codecs, damaged/oversized token rejection, exact static-file routes below a
base path, explicit transport policy, storage key defaults, escaped namespaces,
progress-store switching with in-flight work, isolated aliases, modal policies,
review storage failures and import mismatches, and optional PDF font contracts.
Reproduced regressions cover hash-router preservation when tutorial query
parameters are cleared, synchronous Practice state/action settlement, native
capture with hidden/background duplicate anchors, and cleanup of a highlighted
anchor after the host replaces its DOM node. The codec builder verifies
source/dependency identities and complete notices, reproduces bytes across
dependency installation layouts, and detects changes to the distribution,
notices, lock and builder without upstream access.

The lesson validator has 12 tests covering manifests/drafts, action/fixture
metadata, repeated-anchor context, outcome snapshots, screenshot/evidence
freshness, report formatting and CLI behavior. Those are structural and
provided-evidence checks. They do not execute or visually approve a host.

### Original host

The same implementation was also verified in its original host application,
including that application's own review adapters and test suites. That evidence
belongs to the host and is not repeated here.

## Reproducing

```sh
npm ci
npm run check
npm test
npm run build
npm run build:examples
npx playwright install chromium
npm run test:browser
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may select an existing local Chromium.
The individual browser runners accept output directories for screenshots and
downloads. The CI workflow (`.github/workflows/ci.yml`) runs `npm ci`, check,
test, example builds and the browser tests on Node 22 with Playwright's
Chromium.
