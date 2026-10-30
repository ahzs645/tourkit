# Changelog

## Unreleased

Product-tour support, added while moving RenderCV's driver.js onboarding tour
onto Tourkit. See [MIGRATING_FROM_DRIVER_JS.md](MIGRATING_FROM_DRIVER_JS.md)
and the README's [Product tours](README.md#product-tours) section.

### Manifest

- `step.prepare`: host actions run through `onExecuteAction` before a step's
  anchor is located, in every mode and on every entry (Back included). They
  run during catch-up as well, are kept through Studio drafts and are checked
  by the static validator against the host's declared actions.
- `anchor.align` (`start`, `center`, `end`) lines an attached card up with
  one edge of the control, offset by the stage padding as driver.js does. The
  Studio step editor offers it as "Card alignment".
- `card.size: "compact"`: a narrower card with smaller type for short copy.

### Player

- `labels`: every word on the player's own surfaces, with `{current}`,
  `{total}` and `{criterion}` placeholders. `DEFAULT_TUTORIAL_PLAYER_LABELS`
  and `formatTutorialLabel` are exported.
- `appearance`: backdrop colour and opacity (an explicit opacity also dims
  Practice), cutout padding and radius, attached-card gap, whether the accent
  ring is drawn, a text Skip button, and a close cross instead of the stop
  square.
- `keyboardNavigation`: ArrowRight and ArrowLeft press Next and Back while
  the card offers them, except in editable fields and open application
  dialogs.
- `renderCard`: the host draws the card's contents from the step, labels and
  navigation handlers, and places Tourkit's `notice` content. The card
  element carries `data-card-position` and `--tourkit-arrow-offset` for a
  popover arrow.
- The player re-checks whether the anchor is in view when a CSS transition
  or animation ends, so a control that slides in on a transform no longer
  leaves its step suspended.

### Build

- Tourkit builds from a path inside `node_modules`, where pnpm's store sits
  on GitHub's runners and where pnpm builds a git-hosted Tourkit. Four exported
  components (`Spinner`, `TutorialSetupDetails`, `TutorialLibraryProgress`,
  `StepViewContext`) now declare their return types; declaration emit failed
  on their inferred types there (TS2883). CI builds from such a path.

### Styles

- New CSS variables `--tourkit-accent`, `--tourkit-accent-ink`,
  `--tourkit-ring` and `--tourkit-font`. The ring and its glow are drawn
  from `--tourkit-ring`.
- The default `--tourkit-*` values now have zero specificity, so host rules
  on `.tourkit-surface` and `.tourkit-overlay` override them in any
  stylesheet order. The wrapper of the step overlay has the class
  `tourkit-overlay`.

## 0.1.0

First public release: Practice and Watch playback, semantic recording, the
authoring Studio, the lesson library, screenshot capture, document exports,
share links and the optional review layer.
