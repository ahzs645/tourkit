# Migrating a driver.js tour to Tourkit

This guide moves an onboarding tour written for [driver.js](https://driverjs.com)
onto Tourkit's player without changing what the learner sees. It was written
while moving RenderCV's onboarding tour (`ahzs645/rendercv-app`,
`apps/web/src/features/onboarding/`), which is the worked example throughout.
The API reference is the README's [Product tours](README.md#product-tours)
section.

Tourkit already uses driver.js underneath for the backdrop and its cutout, so
the dimmed-page look carries over directly. What changes is where the tour's
logic lives: driver.js steps are imperative callbacks; a Tourkit tour is a
validated manifest of steps plus a host action executor.

## The shape of the result

| driver.js | Tourkit |
| --- | --- |
| `driver({ steps })` and `tour.drive()` | `<TutorialPlayer manifest={…} mode="practice" />`, mounted while the tour runs |
| A `DriveStep` | A manifest step with `completion: "continue"` (a reading step: advances on Next, nothing graded) |
| `element: '[data-onboarding="x"]'` | `anchor: { id: "x" }` on the step, `data-tutorial-id="x"` on the element |
| `popover.title` / `popover.description` | `overlay.title` / `overlay.body` |
| `popover.side` | `anchor.placement` (`top`, `right`, `bottom`, `left`) |
| `popover.align` | `anchor.align` (`start`, `center`, `end`) |
| `onHighlightStarted` that opens a drawer or switches a tab | `step.prepare`: actions run through `onExecuteAction` before the anchor is located |
| `onNextClick` that sets up the *next* step | The next step's own `prepare` (see below) |
| `onHighlightStarted` that sends analytics | `onStepChange(step, index)` |
| `onCloseClick` / `onDestroyed` → "skipped" | `onStop` (stop control, Skip and Escape) |
| Last step's Done → "completed" | `onComplete` |
| Steps filtered with `null` for a disabled feature | Build the manifest at runtime and leave the step out |
| `showProgress`, `progressText: "{{current}} of {{total}}"` | `overlay.showProgress` (default true), `labels.progress: "{current} of {total}"` |
| `nextBtnText`, `prevBtnText`, `doneBtnText` | `labels.next`, `labels.previous`, `labels.finish` |
| `showButtons: ['next', 'previous', 'close']`, a custom skip button | Built in; `appearance.showSkip` adds a text Skip button |
| `allowClose`, Escape | Escape always stops; there is no click-the-backdrop-to-close |
| `allowKeyboardControl` (arrow keys) | `keyboardNavigation` (skips editable fields and open dialogs) |
| `overlayColor`, `overlayOpacity` | `appearance.overlayColor`, `appearance.overlayOpacity` |
| `stagePadding`, `stageRadius` | `appearance.stagePadding`, `appearance.stageRadius` |
| `popoverOffset` | `appearance.cardGap` (see the offset note below) |
| `animate` | `transitionMs` |
| `popoverClass`, `onPopoverRender` DOM surgery | CSS variables, or `renderCard` for a card that must match exactly |

Pass `persistProgress={false}` for an onboarding tour: Tourkit otherwise
offers to resume an interrupted run. Pass `domPolicy={NEUTRAL_TUTORIAL_DOM_POLICY}`
and `interaction: "guided"` on the manifest so stray clicks cannot open other
surfaces in the middle of the tour.

## Prepare actions instead of `onNextClick`

driver.js tours often set up step *n + 1* in step *n*'s Next handler: switch to
the Design tab, then `moveNext()` after a delay. That breaks Back: returning to
the earlier step leaves the workspace on the later step's tab.

In Tourkit each step names the navigation that puts its own control on screen:

```ts
{ id: "design", completion: "continue",
  anchor: { id: "editor-pane", placement: "right", align: "start" },
  prepare: [{ id: "workspace.section", args: { section: "design" } }],
  overlay: { title: "Design tab", body: "Choose themes, colours and fonts." } }
```

The player runs `prepare` before it looks for the anchor, in every mode and
on every entry, Back included. The contract is that prepare actions are
repeatable navigation, never the mutation the step teaches. RenderCV's executor
makes every action a no-op when the workspace already shows what it asks for,
and waits only for a change it actually made. Its one non-repeatable action,
sending a greeting to the AI editor, is guarded so it fires once per tour.

An executor may return a promise. Use it to wait for an animation to finish
before the anchor is measured (RenderCV waits 350 ms for its 300 ms drawer
slide). The static validator checks `prepare` action IDs against the host's
declared actions, like `step.action`.

## Making the card look the same

Tourkit's built-in card is styled inline, so CSS can recolour it through the
`--tourkit-*` variables but cannot change its layout. When the tour must keep
the host's existing popover, pass `renderCard`. Tourkit still positions the
card, lights the control, moves focus and handles the keyboard. The host
renders the contents from the step's `title`, `body`, formatted `progress`,
`labels` and the `next`, `previous` and `stop` handlers.

RenderCV's `TourCard.tsx` and `tour-popover.css` reproduce the driver.js 1.4
popover as RenderCV had overridden it. They are a template for any
driver-style card:

- Take the old look from the source, not from memory: driver.js's
  `dist/driver.css` for the installed version, plus the host's overrides.
  The overrides interact with driver's rules. For example, driver's
  `.driver-popover-footer button { all: unset }` silently cancelled RenderCV's
  `min-height` on its Skip button, so the original was 16 px tall, not 32.
- Render the `notice` Tourkit passes. It holds the paused, "Bring it into
  view" and blocked-click messages; without it those states are unrecoverable.
- Draw the arrow from `data-card-position` (the side of the control the card
  sits on) and `--tourkit-arrow-offset` (where along that edge the control
  is). The offset follows `anchor.align` the way driver's arrow does.
- driver.js aligns a `start`- or `end`-aligned popover with the lit cutout
  (control plus `stagePadding`), and Tourkit now does the same. Its
  `popoverOffset` is measured from the cutout. Tourkit's `cardGap` is measured
  from the control plus a fixed clearance, so a smaller number gives the same
  distance: RenderCV's 12 px popover offset became `cardGap: 6`.

Then measure, rather than eyeball. Run the old and new tours side by side
(a `git worktree` of the pre-migration commit on a second dev-server port),
and compare `getBoundingClientRect()` and computed font, size and padding for
the card, title, description, footer controls and arrow on each step. RenderCV's
migration converged to within 1 px on every part except the arrow (4 px).

## Things the migration surfaced

- **Anchors must be unique.** `document.querySelector` takes the first match;
  Tourkit refuses to pick between two live elements with the same ID, and the
  step waits until its anchor timeout. RenderCV's backup step
  (`data-export`) matched both the sidebar's App settings button and the
  toolbar's Download menu. Everyone had been seeing App settings only because
  it came first in the document. Search for duplicate IDs before migrating,
  and decide which element each step means.
- **Controls that slide in.** A drawer that moves on a CSS transform causes
  no scroll, resize or size change. The player measured RenderCV's mobile
  drawer mid-slide, decided its control was out of view, and the step stayed
  suspended. The player now re-checks visibility when a transition or
  animation ends. Still give the executor a wait slightly longer than the
  slide.
- **driver.js highlighted moving targets.** driver measured a control the
  moment `onHighlightStarted` began opening its drawer or pane, so the
  original lit the wrong spot on two mobile steps. Prepare-then-locate fixes
  this without any delay tuning.
- **Backdrop clicks.** driver's `allowClose` closed the tour on a backdrop
  click. A guided Tourkit step turns the click away and explains why
  (`labels.blockedHint`), which loses fewer tours to accidental clicks.
  Escape, Skip and the close control still end it.
- **Placeholders.** driver uses `{{current}}`; Tourkit's labels use
  `{current}`. RenderCV converts its existing catalogue strings instead of
  re-translating them.
- **Accessible names.** Tourkit's buttons keep their fuller English names
  ("Next tutorial step") until a host localises the visible label, which
  then names the button too. A host-drawn card owns its own accessible names.
- **Host CSS order.** Tourkit injects its default CSS variables into the
  page at runtime, after the host's stylesheets. They now have zero
  specificity (`:where(…)`), so a host rule on `.tourkit-surface` and
  `.tourkit-overlay` wins whatever the order.
- **Opening state at start.** RenderCV's tour forced the AI editor open when
  it started, which is harmless with the feature flag off but would put a
  modal over every early step with it on. Open surfaces in the step that
  needs them and close them in the steps after.

## Installing with pnpm

Tourkit is installed from GitHub, and its `prepare` script builds `dist/`.
pnpm 10 refuses to run a git-hosted package's build unless it is allowed:

```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - tourkit
```

```json
"tourkit": "github:ahzs645/tourkit#<commit sha>"
```

Pin a commit that is on `main` and includes the CHANGELOG's "builds from a
path inside `node_modules`" fix. On GitHub's runners, `pnpm/action-setup`
puts the store under a `node_modules` directory, and pnpm builds Tourkit
there. TypeScript's declaration emit then treats Tourkit's own files as a
dependency's, and an exported component with an inferred return type fails
with `TS2883`. That broke RenderCV's first CI run even though local installs
passed; Tourkit's CI now builds from such a path too. A commit only on a feature branch can disappear
after a squash merge and branch deletion. The first install builds Tourkit
(about 30 s); later installs reuse pnpm's store. The built `player` entry pulls
in only `driver.js`, `@floating-ui/dom`, `zod`, `lucide-react` and React, plus
driver's own CSS; the export libraries are not bundled.

Two smaller notes. pnpm warns that Tourkit's peer range asks for React 19.3
when a host is on 19.2; it still links the host's single React, which works.
And after changing the pinned commit, clear Vite's dependency cache
(`node_modules/.vite`) or start the dev server with `--force`, otherwise the
dev server keeps serving the previous build.
