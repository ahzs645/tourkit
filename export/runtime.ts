import type { TutorialExportSource } from "./document";
import type { TutorialExportOptions } from "./options";

export interface TutorialExportMetadata {
  /** Fallback document author, omitted from the PDF cover unless customized. */
  defaultAuthor?: string;
  /** Application name stored as the document creator. */
  creator?: string;
}

export interface TutorialPdfFontUrls {
  normal: string;
  bold: string;
  italics: string;
  bolditalics: string;
}

/** Optional app-specific capabilities; static guide exporters need neither host code nor a registry. */
export interface TutorialExportRuntime {
  metadata?: TutorialExportMetadata;
  /** Roboto is bundled. Alternate fonts are an explicit capability of the host. */
  pdfFonts?: { LiberationSans?: TutorialPdfFontUrls };
  interactive?: {
    unavailable(source: TutorialExportSource): string | null;
    export(source: TutorialExportSource, onProgress?: (text: string) => void, options?: Partial<TutorialExportOptions>): Promise<Blob>;
  };
  /** Resolve font/other renderer assets when an application is mounted below a base path. */
  resolveAssetUrl?: (path: string) => string;
}

