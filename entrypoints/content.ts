import { Readability } from '@mozilla/readability';

import type { BrowserPageSnapshot } from '@/src/types/app';
import { normalizeWhitespace } from '@/src/utils/text';

function extractSelection(): string | undefined {
  const selection = window.getSelection()?.toString().trim();
  return selection ? normalizeWhitespace(selection) : undefined;
}

function extractReadableContent(): string {
  const clonedDocument = document.cloneNode(true) as Document;
  const article = new Readability(clonedDocument).parse();

  if (article?.textContent?.trim()) {
    return normalizeWhitespace(article.textContent);
  }

  return normalizeWhitespace(document.body?.innerText ?? '');
}

function buildSnapshot(): BrowserPageSnapshot {
  return {
    title: document.title || location.hostname,
    url: location.href,
    capturedAt: new Date().toISOString(),
    selection: extractSelection(),
    content: extractReadableContent(),
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'capture-page') {
        return undefined;
      }

      const snapshot = buildSnapshot();
      return Promise.resolve({
        ok: true,
        snapshot,
      });
    });
  },
});
