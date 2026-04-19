import type {
  BrowserPageSnapshot,
  CaptureScope,
  PageSnapshotRecord,
} from '@/src/types/app';
import { createId } from '@/src/utils/ids';

const MAX_PAGE_CONTENT = 6000;

type CaptureResponse =
  | { ok: true; snapshot: BrowserPageSnapshot }
  | { ok: false; error: string };

function isCapturableUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  return /^https?:\/\//.test(url);
}

async function queryTabs(scope: CaptureScope): Promise<browser.tabs.Tab[]> {
  if (scope === 'active-tab') {
    return browser.tabs.query({ active: true, currentWindow: true });
  }

  if (scope === 'current-window') {
    return browser.tabs.query({ currentWindow: true });
  }

  return browser.tabs.query({});
}

function hashContent(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return String(hash);
}

function toStoredSnapshot(
  sessionId: string,
  tab: browser.tabs.Tab,
  snapshot: BrowserPageSnapshot,
): PageSnapshotRecord {
  const content = snapshot.content.slice(0, MAX_PAGE_CONTENT);

  return {
    id: createId(),
    sessionId,
    tabId: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    title: snapshot.title,
    url: snapshot.url,
    capturedAt: snapshot.capturedAt,
    selection: snapshot.selection,
    content,
    contentHash: hashContent(content),
  };
}

export async function captureSnapshots(
  sessionId: string,
  scope: CaptureScope,
): Promise<PageSnapshotRecord[]> {
  const tabs = await queryTabs(scope);
  const capturableTabs = tabs.filter((tab) => tab.id && isCapturableUrl(tab.url));

  const responses = await Promise.all(
    capturableTabs.map(async (tab) => {
      try {
        const response = (await browser.tabs.sendMessage(tab.id!, {
          type: 'capture-page',
        })) as CaptureResponse;

        if (!response?.ok) {
          return null;
        }

        return toStoredSnapshot(sessionId, tab, response.snapshot);
      } catch {
        return null;
      }
    }),
  );

  return responses.filter((snapshot): snapshot is PageSnapshotRecord => snapshot !== null);
}
