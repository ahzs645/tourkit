# Chrome recorder, captured websites and Studio

Tourkit can record a website's rendered interface, save its real elements and
visible states, and turn them into an editable tutorial. The recorder, editor and
learner player work locally. A backend service is not required for this workflow.

The captured website and an instrumented application lesson are separate
authoring formats. A capture preserves rrweb DOM snapshots/mutations, supported
CSS and assets, element targets, steps and screenshot checkpoints. An application
lesson invokes the host's semantic actions and checks its state. Importing a
capture does not manufacture semantic actions, declare real data synthetic, or
restore the source application's executable JavaScript.

## Try the complete workflow

Use Node 22 or later in a fresh clone:

```sh
npm ci
npm run package:extension
npm run build:capture-studio
node tooling/build-example.mjs simulated-backend
```

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select `dist-extension/`. The ZIP in `.artifacts/` contains the
   same extension; extract it before loading the folder.
2. Open the source website and click the **TourKit Recorder** toolbar button.
   Enter a title, choose whether to include screenshots, and optionally add
   private CSS selectors. Select **Start on this tab**.
3. Close the popup and perform the workflow. Clicks and form interactions create
   steps; the recorder saves DOM checkpoints around them. Source-site actions
   during recording still act on the source website, so use appropriate demo data.
4. Reopen the popup and choose **Stop recording**. The recorder flushes
   acknowledged chunks and waits for queued screenshots/resources within its
   bounded capture budget. Check any capture notes.
5. Choose **Open in Studio**. This opens the extension's bundled editor with your
   capture already loaded. **All recordings** opens the local session dashboard.
6. Edit and preview the tutorial, then use **Save package** to retain an editable
   `.tourkit` file. Use **More export options → Interactive HTML** for a standalone
   learner file that opens locally, or choose a reading guide.

To try a frontend that uses no real service, serve
`.tmp-tourkit-simulated-backend-example/` over HTTP. For example:

```sh
python3 -m http.server 4173 --directory .tmp-tourkit-simulated-backend-example
```

Open `http://localhost:4173`, record creating a project, save it, reopen it, edit
it and reset the demo. Its API client uses the stateful service adapter described
below. Recorded input values are masked by default; visible text derived from
those inputs still needs review.

## Import into the existing Studio

The existing `TutorialWorkspace` shows **Import captured website**. Selecting it
opens Capture Studio, which accepts a `.tourkit` ZIP, its equivalent `.zip`, or a
`tourkit-browser-capture` JSON file. **Back to application tutorials** returns to
the existing lesson workspace.

The standalone app in `dist-capture-studio/` accepts the same files. Serve that
directory over HTTP to import or try its built-in sample. A web editor cannot
read an extension's private IndexedDB directly; the downloaded package is the
portable handoff. The bundled extension editor reads its own recordings locally.

### What authors can change

| Control | Persisted result |
| --- | --- |
| Tutorial title, step title and instruction | Author-facing and learner-facing text |
| Move earlier/later, delete, include in tutorial | The authored sequence; recorded checkpoint times stay attached to each step |
| Action type | The expected captured-element interaction or explicit Continue |
| Change target | A selected real DOM node, its document identity and useful fallback metadata |
| Edit captured text | A leaf text/input edit applied to matching recorded nodes in that document segment |
| Replace screenshot, description, review | The publishable screenshot and its review state |
| Practice / Watch, Back / Next, Reset | Preview of element-triggered progression, timed playback and deterministic restart |

The editor autosaves valid edits in browser IndexedDB. A **Resume saved edits**
banner offers recovery after reload; it does not silently overwrite newer edits
with the original recording. **Save package** remains the way to move between
browsers or preserve data before uninstalling the extension.

Text editing is an authoring tool, not a comprehensive anonymizer. A name may
also occur in another node, later state, image or screenshot. Interface and image
changes invalidate an earlier reviewed classification. Review all relevant
copies before sharing.

### Exports

| Export | Contains | Intended use |
| --- | --- | --- |
| `.tourkit` package | Validated `capture.json` and a README in a ZIP, including events, assets, steps and publishable screenshots | Reopen and edit in Studio |
| Interactive HTML | Trusted Tourkit player code, CSS, embedded capture data and assets | Open locally or serve as an interactive tutorial |
| HTML guide | Instructions and selected screenshots | Reading/printing |
| Markdown guide | Instructions and screenshot references/data | Documentation workflows |

Capture exports do not include editor-only original screenshot backup pixels.
The capture editor's current document export menu is HTML/Markdown; the existing
semantic lesson editor retains its PDF/DOCX/PPTX/GIF/SCORM exporters. A capture is
not silently converted into a semantic lesson to access those formats.

## How interaction works without the original backend

The player reconstructs actual DOM elements in a script-disabled iframe. Each
authored step points to a captured node and a checkpoint. Clicking the expected
button advances to the next authored state. Input fields accept new learner text,
which is kept as local session state across matching checkpoints. Input steps
complete on an explicit committed interaction, such as Enter, rather than the
first character. The last action can seek its recorded result before completion.
Reset removes learner input and returns to the initial state.

That is sufficient for a guided workflow such as opening a dialog, completing
fields, selecting Save and viewing a recorded success state. Arbitrary new
routes, unseen dropdown options, recalculated charts, server validation and
business rules must be authored or provided by an application integration.
Reordering checkpoints changes tutorial order; it does not infer new causal
states. Preview the sequence after editing.

Replay sanitizes executable elements, event handlers, navigation, forms,
resource references and dangerous CSS before reconstruction. It rewrites known
assets to embedded data and omits unsupported resources. Restrictive CSP and
nested script-disabled frames provide additional isolation. The original
application's JavaScript is never executed in captured playback.

## Stateful service simulation for a frontend you control

`tourkit/simulation` supplies an API-client adapter for a controlled demo
frontend. It supports exact request/response fixtures and explicitly declared
JSON collections. Unknown requests return a demo error and never fall through
to the real network.

```ts
import { createTutorialServiceSimulator } from "tourkit/simulation";

const demo = createTutorialServiceSimulator({
  origin: "https://demo.example",
  collections: [{
    name: "projects",
    path: "/api/projects",
    records: [],
    required: ["name"],
    searchFields: ["name"],
  }],
  fixtures: [{
    id: "current-user",
    request: { method: "GET", url: "/api/me" },
    response: { body: { id: "demo-user", name: "Alex" } },
  }],
});

// Give this function to your owned frontend's API client before startup.
const apiFetch = demo.fetch;
await apiFetch("/api/projects", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Autumn launch" }),
});
const projects = await (await apiFetch("/api/projects")).json();
// GET /api/projects/:id, PATCH/PUT, DELETE and ?q=... share this local state.
demo.reset(); // Restore seeded records, fixture counters and generated IDs.
```

Fixtures match method, normalized URL/query and JSON body. Their optional `times`
field supports sequential recorded responses. Collections support list/detail
reads, create, update, delete, required-field checks and declared-field search.
Snapshots are defensive copies; cookies, redirects and authorization headers
are not synthesized by the service adapter.

This adapter does not automatically attach to arbitrary captured JavaScript,
intercept all XHR/workers/WebSockets, derive server logic or create fixture rules
from intercepted private network traffic. The extension does not request the
`debugger` permission or export API responses. Original-JavaScript app archiving
would require a separate capture/runtime design and explicit origin handling.

## Embedding Capture Studio or the learner

```tsx
import { CaptureStudio, BrowserCapturePlayer } from "tourkit/browser-capture-studio";
import { importBrowserCapture } from "tourkit/browser-capture";
import { createDefaultBrowserCaptureInteractiveExporter } from "tourkit/browser-capture-export";
import "tourkit/styles.css";

const capture = await importBrowserCapture(file); // File/Blob, bytes or JSON
const exportInteractive = createDefaultBrowserCaptureInteractiveExporter(
  new URL("./player-runtime.json", document.baseURI),
);

// Authoring
<CaptureStudio initialCapture={capture} exportInteractive={exportInteractive}
  onCaptureChange={(edited) => saveToYourOwnStore(edited)} />;

// Read-only learner view
<BrowserCapturePlayer capture={capture} />;
```

`npm run build:capture-studio` generates the trusted `player-runtime.json` bundle.
The standalone editor, extension and existing Studio example serve it already.
A custom host must serve that generated file and configure the exporter; the
editor does not fetch executable code from a CDN. The existing workspace accepts
the same exporter as `exportCapturedInteractive`, and its capture entry can be
hidden with `browserCapture={false}`.

Lower-level callers can use `createBrowserCaptureReplay` with a bundled rrweb
Replayer factory. See [browser-capture/README.md](browser-capture/README.md) for
controller methods and capture limits. All imported packages are validated;
archive entries, expanded sizes, checksums and nested JSON have bounded limits.

## Permissions, privacy and practical limits

The shipped manifest requests `activeTab`, `scripting`, `storage` and `downloads`.
Installation grants no permanent all-sites access. Optional per-origin access is
requested when assets need it. CSS/images/fonts are fetched without credentials;
resources that cannot be bundled produce capture notes. Recorded resource URLs
use opaque identifiers; page metadata drops queries and fragments.

All form values and designated private regions are masked/excluded by default.
Screenshots paint over those rectangles before persistence, cover embedded
frames, and are discarded if privacy geometry or the active page changes during
capture. Ordinary page text, image content and URL paths can still identify
people. **Masked** and **reviewed** describe workflow state, not anonymity or
synthetic data. There is no upload service in this implementation.

| Area | Current boundary |
| --- | --- |
| Site access | HTTP(S) pages permitted by Chrome; restricted browser pages cannot be captured |
| Navigation | New document segments on accessible pages; resume from the toolbar after a cross-origin interruption |
| Frames | Opaque/restricted frames become placeholders; every frame's screenshot pixels are masked |
| Shadow DOM | Open roots depend on rrweb support; closed components become placeholders |
| Canvas/WebGL/media | No general editable reconstruction; supported visible appearance may be available in screenshots |
| Screenshots | Visible viewport, after-action timing, bounded rate and size; stale captures can be omitted |
| Assets | Bounded CSS, PNG/JPEG/GIF/WebP and fonts; external SVG, source scripts and HTML assets are excluded |
| Capture budgets | 40 MiB events, 12 MiB assets, 2 MiB per asset, 10 MiB screenshots; additional package limits apply |
| Learner behavior | Visited/authored states and local field values; no inferred unseen application logic |
| Persistence | Local browser storage; export before clearing data or uninstalling |
| Distribution | Load-unpacked development build and installable ZIP; no Chrome Web Store publication implied |

The extension README in [apps/recorder-extension/](apps/recorder-extension/README.md)
contains additional operational details. Inspect capture notes and preview the
offline tutorial before sharing it.

## Verification

```sh
npm run check
npm test
npm run build
npm run build:examples
npm run build:capture-studio
npm run package:extension
npx playwright install chromium
npm run test:browser
npm run test:capture:browser
npm run test:extension:browser
```

The capture browser tests assert real DOM interaction, document identity,
checkpoint input persistence, reset, target selection, no source requests or
script execution, editor recovery, package exchange and a local interactive HTML
export. The extension browser test loads a real MV3 build, records a local
workflow, checks pixel masking and data recovery, then opens and edits it in
Studio. Its disposable test manifest grants screenshot access because automation
cannot activate Chrome's toolbar `activeTab` grant. The distributed manifest is
asserted separately. Manual toolbar-permission and representative-site testing
remain part of preparing a store release.
