import { PageText } from './chunker';

/**
 * Extracts per-page text from a PDF (ADR-0042 §2). A thin wrapper over pdfjs-dist's legacy
 * Node build; page anchors are first-class because a research-document citation must point at
 * a specific page. Returns one PageText per page (1-based), text joined from the page's items.
 */
export class DocumentTextExtractor {
  async extract(pdfPath: string): Promise<PageText[]> {
    // pdfjs-dist is ESM-only; load it dynamically so the CommonJS build can consume it.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const fs = await import('fs/promises');
    const data = new Uint8Array(await fs.readFile(pdfPath));

    const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
    const doc = await loadingTask.promise;
    const pages: PageText[] = [];
    try {
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join('');
        pages.push({ page: pageNo, text });
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }
    return pages;
  }
}
