# Verification record

This is a dated record of what was verified, how, and with what limits. Newest
entries first. It covers Tourkit and its examples; it does not certify any host
application's lessons or workflows. A host records its own evidence.

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
