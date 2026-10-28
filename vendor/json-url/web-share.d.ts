/** Internal six-codec distribution; the upstream algorithms and token format are unchanged. */
export type TutorialShareCodecId = "lz" | "gz" | "df" | "zl" | "raw" | "hgz";
export interface WebShareOptions {
  version?: string;
  maxLength?: number;
  maxDecompressedSize?: number;
  checksum?: boolean;
  /** Required because upstream's full default registry includes excluded codecs. */
  codecs: TutorialShareCodecId[];
}
export default function createWebShareEngine<T = unknown>(options: WebShareOptions): {
  compress(value: T): Promise<string>;
  decompress(token: string, options?: { deURI?: boolean }): Promise<T>;
};
