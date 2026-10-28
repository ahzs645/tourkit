# Player, controls and dialogs

## Source map

Read the relevant files in the located Tourkit checkout:

| Contract | Source |
| --- | --- |
| Player props and executors | `player/types.ts` |
| Manifest, anchors, outcomes, v1 view keys | `core/schema.ts` |
| Bus, registry and result envelopes | `core/actions.ts` |
| Anchor visibility/ambiguity and expanded lists | `player/anchor.ts` |
| Modal suspension and view recovery | `player/tutorial-player.tsx` |
| Portals, guided input and Escape | `player/tutorial-overlay.tsx` |
| Focus trap, stacked dialogs, focus restoration | `ui/dialog-shell.tsx` |
| Shared modal chrome | `ui/modal.tsx` |
| Dropdown semantics and body portal | `ui/builder-select.tsx` |
| Tutorial focus-surface marker/theme | `player/surface.ts` |
| Host dialog/window conventions | `player/dom-policy.ts` |
| Scoped resume and completion | `player/progress.ts`, `player/completion-store.ts` |

## Wire commands and outcomes

Separate domain operations from observations that a person invoked them. For
example, call `createContact()` from the UI, then report
`tutorialActionBus.observe("contacts.save", payload, createdContact)`. Register
the same operation for Watch without emitting a duplicate user event. Use
`gesture`/`source: "derived"` for synchronous internal actions that should remain
one recorded step.

For full Studio support, create a stable `TutorialActionBus`, observe UI
actions on it, pass it to `createTutorialActionRegistry`, and set
`TutorialSessionIntegration.actionBus` to that same bus. The authoring bridge
subscribes to the supplied bus; omission preserves `tutorialActionBus` for
existing applications. Pass an equivalent subscription to the player for
action-gated Practice. Avoid duplicate bundled copies of Tourkit (and of
React).

Adapt the registry return value:

```ts
const execute = async (
  action: TutorialSemanticAction,
  context?: TutorialExecutionContext,
) => (await registry.execute(action, context?.signal)).result;
```

Import the action type from `core` and execution context from `player`.
Player/capture supply context; the authoring bridge calls the executor with
only the action. Keep context optional when sharing this adapter, or provide
separate typed wrappers. Register commands
once per runtime scope, unregister component-scoped handlers, fail explicitly
for unsupported actions, and await async domain work. Do not substitute
synthetic clicks for the app's semantic operations merely to advance Watch.

Use immutable snapshots and readable checks, such as
`{ all: [{ path: "contacts", where: { type: "colleague" }, count: { min: 1 } }] }`.
Use delta checks when a new object is required so pre-existing data cannot
accidentally satisfy the lesson. Return/capture stable IDs for later references.

Mount one active player per document, at an application root outside transformed,
clipped or inert containers. The step overlay portals to body, but standalone
resume/error/completion surfaces render where the player is mounted. Driver
and CSS remain document-wide. Custom buses, surface registries and persistence
scopes separate host integrations; they do not establish support for
simultaneous active players in one document.

## Modal and portal contract

`Modal`/`DialogShell` already supply body portals, stacked Escape handling,
initial focus, Tab containment and opener-focus restoration. Their trap includes
controls in `[data-tutorial-surface]` and `[data-overlay-focus-surface]` so the
tutorial remains reachable while a modal is open.

Use a visible `role="dialog"` with `aria-modal="true"`. Unmount closed dialogs or
mark them hidden/inert consistently. Offscreen active content is not closed.
An unrelated open modal may pause a lesson; a modal targeted by the current or
next step should remain usable. Give its controls their own stable anchors.

Pass `domPolicy` to `TutorialPlayer` and `TutorialCaptureRun`. New hosts should
start from `NEUTRAL_TUTORIAL_DOM_POLICY`, then supply `stepExpectsDialog(step)`
when an outcome deliberately opens a dialog around an outside control. Its
`applicationDialogSelector` identifies blocking dialogs; the optional
`floatingWindowSelector` helps choose an anchor in foreground modeless windows.
Use the host's actual snapshot vocabulary in the predicate. Omitting the prop
uses `DEFAULT_TUTORIAL_DOM_POLICY`, currently `LEGACY_TUTORIAL_DOM_POLICY`,
which recognises `.pb-window` floating windows and treats `surfaces.*` checks as
dialog-opening; pass a policy explicitly. Policy is
passed per run, not set globally. Selecting native dialog elements does not
solve the browser top-layer limitations below.

When retaining another modal implementation:

1. Permit focus/pointer interaction with the tutorial's marked surface. Keep
   ordinary containment, but do not redirect tutorial focus back into the modal.
2. Ensure the modal library does not make the tutorial portal inert or
   aria-hidden as an outside sibling. Check keyboard access/accessibility state.
3. Exempt the tutorial surface from document-capture outside-click dismissal
   where needed; stopping bubble events alone cannot defeat a capture listener.
4. Verify stacking. Current dim/ring/card layers are around 7900–8000, with
   player menus and standalone cards higher. There is no portal-root/z-index
   prop. Adapt the host deliberately instead of escalating arbitrary z-indexes.
5. Test Escape ordering: dismiss the active picker/modal first as appropriate
   without accidentally stopping the lesson. Test Stop/Back/Next inside a modal.

**Native `dialog.showModal()`, native popovers and fullscreen top-layer content
need an explicit strategy.** The overlay portals to `document.body`; normal
z-index does not put it above the browser top layer or undo native modality's
inert content. Reuse a normal DOM modal or design/test a portal extension.
For native modal behavior, see the
[HTML Standard's modal-dialog inertness rules](https://html.spec.whatwg.org/multipage/interaction.html#modal-dialogs-and-inert-subtrees).
Document queries also do not discover anchors inside shadow roots. Run the
player inside the target iframe rather than expecting parent anchors to cross it.

## Dropdowns and anchors

Use one visible control per anchor ID. Ambiguous live matches intentionally
resolve to no anchor. Put checkbox/radio anchors on real inputs; the highlight
can use a visible label's rectangle.

For a portaled listbox/menu, expose `aria-expanded="true"` and `aria-controls`
on the trigger, pointing to the popup's real ID. Shared selection controls do
this. A nearby popup without that relationship cannot be reliably associated
with its trigger. Preserve roles and keyboard behavior.

`BuilderSelect` and `BuilderCombobox` accept `data-tutorial-id` and
`data-tutorial-aliases` directly and put them on the actual trigger/input.
Use those props instead of adding a duplicate wrapper anchor or stamping the
DOM after render. The aliases attribute is a whitespace-separated list.

Prefer `interaction: "free"` for outcome-based Practice. Guided mode limits
pointer targets; test its allowed dialog and picker path. Overlay dismissal is
not a substitute for satisfying an outcome.

## Styling

Compile/import `styles.css` once with Tailwind v4 for an independent app. If
the app already owns preflight, import `ui/theme.css` after Tailwind and add
the Tourkit sources to Tailwind's `@source` list. Include CSS modules for the checkbox and Driver's CSS import.
Put `.dark` on html/body so body portals share the mode.

Tourkit's example build (`tooling/build-example.mjs`) already compiles the
theme and scans its sources and HTML shell. Those example entrypoints deliberately do
not import a second full stylesheet.

