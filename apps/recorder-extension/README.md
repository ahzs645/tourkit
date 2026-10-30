# TourKit Recorder for Chrome

TourKit Recorder is a Manifest V3 extension for capturing a website's rendered
interface and interactions, then editing the recording in the bundled Capture
Studio. It records rrweb DOM snapshots and mutations, element targets, local
assets, tutorial steps and optional native screenshot checkpoints. Playback uses
TourKit's own controls; the captured site's original application scripts and
backend are not executed.

## Build and install

```sh
npm ci
npm run build:extension
```

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Turn on **Developer mode**, choose **Load unpacked**, and select
   `dist-extension` from this repository.
3. Pin **TourKit Recorder**, open the website you want to capture, and select the
   extension button.
4. Give the recording a title and select **Start on this tab**. Close the popup
   and walk through the workflow.
5. Reopen the popup to pause or stop. **Open in Studio** opens the captured
   interface in the editor; **Download .tourkit** saves a portable recording.

No account or upload service is required. The extension stores acknowledged
event chunks and assets in its own IndexedDB database. The dashboard lists saved
recordings, supports renaming and deleting, and can open Studio to import a
previously downloaded `.tourkit` file. Uninstalling the extension removes its
local data, so download recordings you want to keep.

## Capture and playback

Click steps store the DOM immediately before the recorded action and the later
result checkpoint. Input steps do not retain entered values. Screenshot
checkpoints are taken **after** an action; their timestamp is stored separately
so the editor can distinguish them from the action's starting state. A final
result step is added when recording stops.

Navigation within a permitted site starts a new document segment. If Chrome
withdraws access after navigation to another origin, the recording is marked
interrupted. Open the extension on the destination site and select **Resume on
this tab**. Resuming preserves earlier acknowledged chunks and adds a fresh
snapshot. A tab close or browser restart does not delete existing recordings.

## Privacy behavior

- All input and textarea values, editable text, `.rr-mask`, `.rr-block`,
  `[data-tourkit-mask]`, `[data-tourkit-private]`, and `[data-private]` regions
  are masked or excluded. Add site-specific private selectors before recording.
- Native screenshots are processed in memory before storage. Inputs and private
  rectangles are painted over; embedded frames are covered because their
  internal transforms cannot be reliably mapped to top-level screenshot pixels.
- A screenshot is discarded if the page, viewport, active tab, or measured
  private regions change during capture. Unredacted originals are not stored.
- Resource references use opaque identifiers. Source page metadata drops query
  strings and fragments. The recorder does not export cookies, authorization
  headers, local storage, or API response bodies.
- **Masked is not anonymous.** Visible names, ordinary page text, images,
  attribute content, and source paths can still contain private information.
  Review the complete recording and screenshots before sharing.

## Assets and permissions

Installation requests `activeTab`, `scripting`, `storage`, and `downloads`.
Optional per-site host access can be granted when CSS, images or fonts come from
other origins. The dashboard lists missing resource origins and exposes **Grant
asset access**. Return to the source tab and resume capture after granting access.
Asset requests omit credentials. Private/CDN assets that cannot be fetched are
listed as capture notes rather than silently treated as portable.

The collector supports PNG, JPEG, GIF, WebP, WOFF/WOFF2, TTF/OTF and CSS. It
rewrites nested CSS URLs and imports into bundled identifiers with bounded
recursion. Original JavaScript, HTML and external SVG assets are not bundled or
executed. Inline SVG remains part of the captured DOM subject to player
sanitization. Each asset is limited to 2 MiB, the asset bundle to 12 MiB, event
storage to 40 MiB, and screenshots to 10 MiB per recording.

## Current boundaries

- Restricted browser pages cannot be recorded.
- Cross-origin/restricted frames and closed Shadow DOM components are replaced
  with placeholders. Same-origin accessible frame DOM may be captured by rrweb;
  all frame pixels are masked in screenshots.
- Canvas/WebGL contents, streaming media and native browser dialogs are not
  reconstructed as editable DOM. Screenshot checkpoints preserve supported
  visible rendering, with explicit capture notes.
- Screenshots capture the visible viewport and are rate limited. They are not
  full-page screenshots or video.
- A recording covers visited and authored states. Original event handlers,
  arbitrary new workflows and application business rules do not reappear merely
  because the DOM was captured.
- Network interception and original-JavaScript application archives are a
  separate capability. This build deliberately does not request `debugger` and
  does not claim to provide a universal backend clone.

For a functioning frontend against simulated services, use a dedicated app/demo
integration and explicit mock handlers. The portable capture player can run
without any source-site login or backend connection.
