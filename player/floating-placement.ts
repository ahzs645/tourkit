import { computePosition, flip, hide, offset, shift } from "@floating-ui/dom";
import { fittingCardHeight, isCardCorner, pickCardPlacement, unionRect, type CardPosition, type CardSide } from "./card-placement";

import { tutorialPlacementRegion } from "./placement-region";
import { visibleClientRect } from "./visibility";

/** Keep the whole teaching region clear, while aligning with its precise control. */
export async function positionTutorialCard(
  anchor: HTMLElement,
  target: HTMLElement,
  card: HTMLElement,
  preferred: CardSide | null,
  current: CardPosition | null,
  gap: number,
) {
  const focus = target.getBoundingClientRect();
  const context = tutorialPlacementRegion(target);
  const avoid = unionRect(visibleClientRect(anchor), unionRect(visibleClientRect(context), focus), 14);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const border = card.offsetHeight - card.clientHeight;
  const naturalHeight = Math.min(card.scrollHeight + border, viewport.height - 32);
  const height = fittingCardHeight({ avoid, focus, card: { width: card.offsetWidth, height: naturalHeight }, viewport, gap });
  const maxHeight = `${height}px`;
  if (naturalHeight > 0 && card.style.maxHeight !== maxHeight) card.style.maxHeight = maxHeight;
  const placement = current && !isCardCorner(current) ? current : preferred ?? "right";
  const sides: CardSide[] = ["right", "left", "bottom", "top"];
  const fallbacks = [...new Set([preferred, ...sides])].filter((side): side is CardSide => Boolean(side) && side !== placement);
  const result = await computePosition(target, card, {
    strategy: "fixed",
    placement,
    middleware: [
      offset(({ placement: side }) => gap + ({
        right: avoid.right - focus.right,
        left: focus.left - avoid.left,
        bottom: avoid.bottom - focus.bottom,
        top: focus.top - avoid.top,
      }[side.split("-")[0] as CardSide])),
      flip({ padding: 12, crossAxis: false, fallbackPlacements: fallbacks }),
      shift({ padding: 12 }),
      hide({ strategy: "referenceHidden" }),
    ],
  });
  // A large teaching region can leave no viable side at all. Retain the
  // tutorial-specific clear-corner fallback instead of obscuring the control.
  const fits = result.x >= 11 && result.y >= 11
    && result.x + card.offsetWidth <= viewport.width - 11
    && result.y + card.offsetHeight <= viewport.height - 11
    && !(result.x < avoid.right && result.x + card.offsetWidth > avoid.left
      && result.y < avoid.bottom && result.y + card.offsetHeight > avoid.top);
  const position = fits
    ? { left: result.x, top: result.y, position: result.placement as CardSide }
    : pickCardPlacement({ avoid, focus, card: { width: card.offsetWidth, height: card.offsetHeight }, viewport, preferred, current, gap });
  return { ...position, referenceHidden: Boolean(result.middlewareData.hide?.referenceHidden) };
}

