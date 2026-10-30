# Portable browser captures

`tourkit/browser-capture` stores a recorded interface independently of a host
application's semantic tutorial adapter. A capture contains rrweb events, editable
checkpoints, element identities, embedded assets, optional PNG screenshots, source
page metadata, and explicit capture/review status.

This is a reconstructed DOM player. It does not execute the recorded application's
JavaScript, preserve its event handlers, or implement its backend. Expected learner
actions move between captured checkpoints. Text/select/checkbox values entered by
the learner persist for matching node identities within a source document.

## Format and import/export

The format identifier is `tourkit-browser-capture`, version `1`. See `types.ts` for
the complete contract. `events` retain the capture engine's JSON payload; `atMs`,
`afterMs`, and `screenshotAtMs` are offsets from the first event's timestamp.
An action checkpoint describes the state **before** its action. Optional `afterMs`
identifies the resulting state. A screenshot taken after a click should have its
own `screenshotAtMs` and descriptive caption instead of implying that it shows the
pre-action state.

Each navigation or document reload should emit the following rrweb custom event
before that document's first snapshot. Document identity prevents reused rrweb
node IDs from carrying targets or learner inputs into another page:

```ts
{
  type: 5,
  timestamp: Date.now(),
  data: {
    tag: "tourkit-document",
    payload: { documentId: "document-uuid" },
  },
}
```

The `documentId` must reference `pages[].id`. Page metadata keeps only an HTTP(S)
origin and pathname. `sanitizeCaptureSourceUrl()` removes URL credentials, query
parameters, and fragments; it does not claim that a pathname contains no personal
data. The recorder must independently sanitize its event payloads.

```ts
import {
  importBrowserCapture,
  exportBrowserCaptureZip,
  serializeBrowserCapture,
} from "tourkit/browser-capture";

const capture = await importBrowserCapture(file); // JSON, Blob, bytes, or ZIP
const json = serializeBrowserCapture(capture, true);
const zip = await exportBrowserCaptureZip(capture);
```

ZIP output contains `capture.json` and `README.txt`. JSON includes the embedded
assets; consumers do not need an asset server. Imports validate format version,
plain JSON structure, event order, checkpoint bounds, duplicate IDs and resource
references. Default limits are 64 MiB, 200,000 events, 2,000 steps, 2,000 assets,
160 JSON nesting levels, and 1,000,000 JSON values. ZIP imports inspect filenames
and expansion sizes before decompression, stream with a size ceiling, and verify
CRC integrity. Unknown archive entries and executable asset types are rejected.

Assets support raster images, fonts, and CSS as base64 data URLs. An asset's `url`
is a lookup identifier: prefer an opaque identifier, such as
`urn:tourkit:asset:hash`, to retain resource identity without preserving signed
query strings. It must match the resource reference in captured attributes/CSS.
The player converts captured stylesheet links into inline styles, resolves bundled
CSS imports with bounded recursion, and replaces embedded image/font references.
Missing resources stay blocked; replay does not fetch the original URL.

## Replay adapter

The core entry point does not depend on rrweb. Supply a compatible engine factory:

```ts
import { Replayer } from "@rrweb/replay";
import { createBrowserCaptureReplay } from "tourkit/browser-capture";

const controller = createBrowserCaptureReplay({
  capture,
  root: document.getElementById("capture-stage")!,
  createReplayer: (events, options) => new Replayer(
    events as ConstructorParameters<typeof Replayer>[0],
    options as ConstructorParameters<typeof Replayer>[1],
  ),
  onComplete: () => console.log("Practice complete"),
});
await controller.ready;
```

The controller supports checkpoint seeking, next/back/reset, element picking,
root-relative target geometry, learner variables, and an `isComplete()` state.
`setAutoAdvance()` changes the interaction mode without rebuilding the recording
or discarding learner values. Inputs complete on change/blur or Enter, never on
the first typed character. A step's optional `value` is an **authored required
answer**; recorders should omit observed or masked values from that field.

The final expected action seeks to its `afterMs` result before invoking
`onComplete`. Disabled steps are skipped during next/back, and step order is the
authored array order; it does not have to be chronological. Explicitly seeking a
disabled step remains available for editing. Reset clears learner values and
restores the first enabled checkpoint.

## Isolation and privacy

Replay takes place inside an outer iframe with `sandbox="allow-same-origin"` and
a restrictive CSP installed before the engine is constructed. rrweb creates its
own script-disabled iframe inside that boundary. The portable playback copy
removes original scripts, event attributes, frame HTML, form destinations,
external resources, active SVG animation, and executable plugin/canvas events.
Source CSS is rewritten, including escaped URL tokens and incremental style
changes. Fonts come through captured CSS/assets; rrweb Font events are omitted
because the engine can construct those fonts in its host document.

The player does not inherit source scripts, allow production API calls, or silently
fall back to remote resources. Canvas pixels can be shown as a captured image when
the source snapshot includes one; opaque/cross-origin media and uncaptured states
remain capture limitations. An engine/version compatibility error remains visible.

`privacy.mode` is `masked`, `reviewed`, or `unreviewed`. Neither sanitization nor
import/export promotes that status or asserts that content is synthetic. Playback
isolation does **not** redact names, values, screenshots, URLs inside event data,
or uploaded documents. Redaction belongs to the recorder/editor and must cover
both DOM data and screenshot pixels. Portable exports strip `sourceDataUrl` image
backups so a redacted screenshot does not carry its original pixels with it.

## Verification

Run the portable format and sanitizer tests:

```sh
npx vitest run --config vitest.config.ts browser-capture/capture.test.ts
```

Run the real Chromium isolation and interaction test:

```sh
node --test tooling/capture-runtime-browser.test.mjs
```

Set `TOURKIT_TEST_CHROMIUM` to a Chromium executable when using a managed runtime.
The browser test checks malicious HTML/CSS/mutations, absence of requests to the
source origin, target picking and scaled geometry, document identity, input
completion, learner-value retention, final result rendering, and reset.
