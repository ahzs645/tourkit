import createWebShareEngine from "./vendor/json-url/web-share.js";
import { buildTutorialLaunchUrl, TutorialManifestSchema, type TutorialManifest, type TutorialMode } from "./core/schema";

/**
 * Tutorials shared as links, with no server: the player manifest travels in
 * the URL as a json-url web-share token (versioned, checksummed, shortest of
 * several codecs — the same engine as builder share links).
 *
 * A shared tutorial is untrusted input, so what it may carry is narrowed on
 * both ends: no screenshots or recorded narration (images and audio do not
 * fit a URL, and a narration src could point anywhere), a launch path that
 * names a real stage, only the launch-hash keys tutorials use, and docs links
 * inside this site.
 */
export const TUTORIAL_SHARE_PREFIX = "link:";
/** Studio's hash param that imports a shared tutorial as an editable copy. */
export const TUTORIAL_SHARE_IMPORT_PARAM = "share";
/** Same budget as builder share links; a typical tutorial is 1–4k characters. */
const MAX_TOKEN_LENGTH = 12_000;
/** Links longer than this can be cut off by some chat and email tools. Built-in tutorials run 1–5k. */
export const TUTORIAL_SHARE_SOFT_LIMIT = 4_000;
const SITE_PATH = /^\/(?!\/)[^\s\\]*$/;

export interface TutorialSharePolicy {
  /** Explicit app-owned allowlist. Sharing never authorizes a new route. */
  allowedLaunchPaths: () => ReadonlySet<string>;
  allowedHashKeys?: readonly string[];
  isSiteAssetPath?: (path: string) => boolean;
}

/** Optional transport; the default is the pinned, compatible t1 codec distribution. */
export interface TutorialShareTransport {
  compress(value: TutorialManifest): Promise<string>;
  decompress(token: string, options?: { deURI?: boolean }): Promise<unknown>;
}

/** One codec per application policy, with no shared registry or mutable global configuration. */
export function createTutorialShareCodec(policy: TutorialSharePolicy, transport?: TutorialShareTransport) {
  const allowedHashKeys = new Set(policy.allowedHashKeys ?? []);
  const isSiteAssetPath = policy.isSiteAssetPath ?? ((path: string) => SITE_PATH.test(path));
  const engine = transport ?? createWebShareEngine<TutorialManifest>({
    version: "t1",
    maxLength: MAX_TOKEN_LENGTH,
    maxDecompressedSize: 4 * 1024 * 1024,
    checksum: true,
    // Only codecs every browser can decode: the engine picks the shortest the
    // *sender* supports, and brotli (br/hbr) tokens made where it exists — Node,
    // some browsers — fail to open where it does not.
    codecs: ["lz", "gz", "df", "zl", "raw", "hgz"],
  });

  /** Validates and narrows a manifest to what a link may carry. Throws when it cannot run safely. */
  function shareableTutorialManifest(input: unknown): TutorialManifest {
    const manifest = TutorialManifestSchema.parse(input);
    const allowedPaths = policy.allowedLaunchPaths();
    // Exact file/router routes are valid; retain directory normalization for links made before exact routes.
    const requested = manifest.launch.path;
    const path = allowedPaths.has(requested) ? requested : requested.endsWith("/") ? requested : `${requested}/`;
    if (!allowedPaths.has(path)) throw new Error("This tutorial link names a page that tutorials do not run on.");
    const hash = Object.fromEntries(Object.entries(manifest.launch.hash).filter(([key]) => allowedHashKeys.has(key)));
    return {
      ...manifest,
      docs: manifest.docs && isSiteAssetPath(manifest.docs) ? manifest.docs : undefined,
      launch: { ...manifest.launch, path, hash },
      chapters: manifest.chapters.map((chapter) => ({
        ...chapter,
        steps: chapter.steps.map(({ screenshot: _screenshot, narration, ...step }) => ({
          ...step,
          // Built-in narration served from this site survives; recorded (blob/data) or remote audio does not.
          ...(narration && isSiteAssetPath(narration.src) ? { narration } : {}),
        })),
      })),
    };
  }

  async function encodeTutorialShare(manifest: TutorialManifest): Promise<string> {
    try {
      return await engine.compress(shareableTutorialManifest(manifest));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The tutorial could not be encoded.";
      if (message.includes("exceeds maxLength")) throw new Error("This tutorial is too long to fit in a link. Share it as a file instead.");
      throw new Error(message);
    }
  }

  async function decodeTutorialShare(token: string): Promise<TutorialManifest> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error("The tutorial link is empty.");
    if (trimmed.length > MAX_TOKEN_LENGTH * 3) throw new Error("This tutorial link is too long. Ask for a tutorial file instead.");
    let decoded: unknown;
    try {
      decoded = await engine.decompress(trimmed, { deURI: true });
    } catch {
      throw new Error("This tutorial link is damaged or incomplete. Ask for the link again.");
    }
    return shareableTutorialManifest(decoded);
  }

  return { shareableTutorialManifest, encodeTutorialShare, decodeTutorialShare };
}

export type TutorialShareCodec = ReturnType<typeof createTutorialShareCodec>;

/** Opens the tutorial on its stage in Try it or Watch mode: `<launch>#…&tutorial=link:<token>`. */
export function tutorialShareRunUrl(manifest: TutorialManifest, token: string, mode: TutorialMode, origin: string): string {
  const launch = buildTutorialLaunchUrl(manifest.launch);
  const params = new URLSearchParams({ tutorial: `${TUTORIAL_SHARE_PREFIX}${token}`, tutorialMode: mode });
  return `${origin}${launch}&${params.toString()}`;
}

/** Opens Tutorial Studio and offers to save the tutorial as an editable copy. */
export function tutorialShareImportUrl(token: string, studioUrl: string): string {
  return `${studioUrl}#${new URLSearchParams({ [TUTORIAL_SHARE_IMPORT_PARAM]: token }).toString()}`;
}


