import Dexie, { type Table } from 'dexie';

import type {
  ChatMessageRecord,
  PageSnapshotRecord,
  PendingToolApprovalRecord,
  SessionRecord,
} from '@/src/types/app';

class WebLoomDatabase extends Dexie {
  sessions!: Table<SessionRecord, string>;
  messages!: Table<ChatMessageRecord, string>;
  pageSnapshots!: Table<PageSnapshotRecord, string>;
  pendingApprovals!: Table<PendingToolApprovalRecord, string>;

  constructor() {
    super('webloom');

    this.version(1).stores({
      sessions: 'id, updatedAt, lastMessageAt',
      messages: 'id, sessionId, createdAt',
      pageSnapshots: 'id, sessionId, capturedAt, url',
      pendingApprovals: 'id, sessionId, createdAt',
    });
  }
}

export const db = new WebLoomDatabase();
