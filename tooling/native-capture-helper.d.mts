import type { TutorialDomPolicy } from "../player/dom-policy";

export function buildNativeCaptureBoundsScript(options?: {
  regionSelector?: string;
  adapter?: string;
  root?: string;
  tsconfig?: string;
}): Promise<string>;

export function buildNativeCaptureAnchorScript(options?: {
  /** Only the selectors are used; stepExpectsDialog is not serialized. */
  domPolicy?: TutorialDomPolicy;
  root?: string;
  tsconfig?: string;
}): Promise<string>;
