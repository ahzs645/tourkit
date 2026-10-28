# Optional review addon

The review subpath is optional. Core, player, recording and Studio do not import
it. A host attaches it to its interface using `ReviewSurface`, or connects
`StudioReviewHost` through Studio's existing optional review adapter.

It provides pinned comments, notes, drawings, pictures, replies, review rounds,
resolve/reopen, part fingerprints, snapshots, an author inbox and file exchange.
The model, browser storage, inbox store and file helpers can also be imported
from their individual files without mounting the UI.

## Host composition

```tsx
import {
  createReviewEnvironment,
  ReviewEnvironmentProvider,
  ReviewFeedbackLayer,
  ReviewInboxHost,
  type ReviewSurface,
} from "tourkit/review";

// Create once per app/user, outside the rendering loop.
const reviews = createReviewEnvironment({
  namespace: "proposal-editor:user-42",
  kinds: ["proposal"],
  labels: () => ({
    title: "Proposal", one: "paragraph",
    changed: "Paragraph edited", removed: "Paragraph removed",
  }),
});

function ReviewedProposal({ surface, children }: {
  surface: ReviewSurface;
  children: React.ReactNode;
}) {
  return <ReviewEnvironmentProvider value={reviews}>
    <ReviewFeedbackLayer surface={surface}>{children}</ReviewFeedbackLayer>
    <ReviewInboxHost kinds={["proposal"]} dropHint="open it here" />
  </ReviewEnvironmentProvider>;
}
```

The surface supplies a stable kind/id, title, target, current parts, anchor
attributes and `place(pick)`. `place` returns the part id, readable label and
page for the point the reviewer selected. `showsItem` and `viewKey` optionally
restrict feedback to a current step/page. Update the surface when the view or
parts change; the layer preserves feedback for the same subject and resets its
local state when the subject's storage identity changes.

See [`examples/review.tsx`](../examples/review.tsx) for an unrelated proposal
editor with paragraph anchors. It includes the full layer and author inbox.
Its `partsFor` adapter compares a returned review against the latest proposal,
so edited paragraphs are flagged. Form fields and emulator screen naming are
not required by this example.

## Inbox, storage and scope

`createReviewStorage` gives reviewer identity and in-progress-review persistence.
`createReviewInboxStore` gives a separate observable author inbox. Both accept a
namespace and an optional storage implementation (`getItem`, `setItem`,
`removeItem`) or lazy provider. Passing `null` makes storage visit-only. Blocked
storage and quota failures preserve the current in-memory review; oversized
snapshots are omitted from the persistence fallback before comments are dropped.

Inbox subscribers see local edits and matching browser `storage` events.
Subscribing after hydration restores saved data. Dirty in-memory edits that
could not be persisted are not overwritten by that restoration. Each inbox
keeps one returned review per subject kind. Importing the same kind/name/id
merges rounds, replies, edits and deletion markers; another subject replaces
that kind's current inbox entry.

```ts
reviews.inbox.import(returnedBundle, { open: [returnedBundle.form.kind] });
reviews.inbox.open(["proposal"]);
reviews.inbox.set("proposal", null);
```

Namespace choices are host-owned. Use separate environment instances when app
or user scope changes. These local stores do not provide authentication,
server synchronization or a shared multi-user review service.

A host with reviews already saved under its own keys passes them through
`createReviewStorage({ personKey, reviewKey })` and
`createReviewInboxStore({ storageKey })`. Field notes, page mapping, label
reconciliation and other subject-specific behaviour stay in the host, which
wraps the same review UI and model rather than reimplementing them.

## Tutorial and Studio adapters

A tutorial/player pair has an explicit step channel:

```tsx
const steps = createTutorialReviewStepStore();
// Pass steps.reportStep to TutorialPlayer.onStepChange.
<TutorialReviewLayer manifest={lesson} mode="practice" stepStore={steps} />
```

Create the store once, and reset it when starting a new run. Separate stores
prevent reviews of different players from sharing a step index. The layer
opens for review links (`#review=start` or `#review=continue`); `enabled` can
be supplied by a controlled host. `labelAnchor` can customize control names.

`StudioReviewHost` accepts a draft and `onFocusStep`. Its default subject kind
is `tutorial`; a host can opt into further inbox kinds. It only offers
**Go to step** when the returned subject matches the open draft and the step
still exists.

## File and compatibility contracts

- Existing version-1 review bundles, legacy files without a subject kind,
  replies, rounds, deletion markers, pictures and snapshots remain readable.
- New files are written as `tourkit-review-feedback` (format, HTML data id),
  with `tourkit-review-ready`/`tourkit-review-bundle` handoff messages and
  `urn:tourkit:` W3C annotation ids. Files written before the Tourkit rename
  (`webforms-review-feedback`) are still read, and an older page's
  **Continue this review** still hands its bundle over; they are never written.
- The `form` object and `fieldId`/`fieldFingerprint` fields retain their wire
  names while representing any review subject and part.
- Subject kinds now accept stable lowercase ids, so another application can
  use `proposal`, `document` or another vocabulary. Older readers restricted
  to `form`, `tutorial` and `emr` need the updated reader for those new kinds.
- The historical `noPatientData: true` picture field remains required. The
  default confirmation covers private/sensitive information; a host can supply
  its own wording.
- HTML/ZIP round-trip the editable bundle. PDF and Markdown are reading and
  checklist outputs. Snapshot rendering uses `html2canvas-pro`; PDF uses
  pdfmake's bundled fonts. Actual file generation uses the same source as UI
  exports.
- Continuation links use HTTP(S). The standalone HTML sends its bundle only
  to the origin of the continuation link. Unsafe/unusable links are omitted
  while leaving the review itself exportable.

A mismatched file can be opened for inspection, but is not silently merged
into the current subject's feedback. Parts absent from the current surface
remain listed without a pin.

## Checks

```sh
npm run build:examples
node --test tooling/review-browser.test.mjs
```

The browser runner serves the built example on a temporary local port. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using an existing Chromium binary;
otherwise install Playwright's Chromium. `TUTORIAL_REVIEW_EXAMPLE_DIR` overrides
the build directory and `TUTORIAL_REVIEW_SCREENSHOTS` the proof image directory.

The test runs at desktop and narrow widths. It adds a real pinned comment,
replies, resolves/reopens, draws, captures and exports HTML, imports that file
in a fresh browser context, verifies changed-part detection and operates the
inbox. Pure/component tests additionally cover legacy files and keys, namespace
isolation, blocked storage, cross-tab changes and scoped tutorial step channels.
