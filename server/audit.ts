import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuditEntry } from '../src/shared/protocol';

export interface AuditLog {
  append: (entries: AuditEntry[]) => void;
  markUndone: (id: string) => void;
  recent: (limit: number) => AuditEntry[];
  count: () => number;
  sessionId: string;
}

export function openAuditLog(file = 'data/audit.sqlite'): AuditLog {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`create table if not exists audit (
    id text primary key, session text not null, at_min real not null, wall text not null,
    actor text not null, action text not null, detail text not null, undoable integer not null, undone integer not null default 0
  )`);
  const sessionId = new Date().toISOString();
  const insert = db.prepare('insert or replace into audit (id, session, at_min, wall, actor, action, detail, undoable, undone) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const undo = db.prepare('update audit set undone = 1 where id = ?');
  const recentStmt = db.prepare('select * from audit where session = ? order by wall desc limit ?');
  const countStmt = db.prepare('select count(*) as n from audit where session = ?');
  return {
    sessionId,
    append(entries) {
      for (const e of entries) insert.run(e.id, sessionId, e.atMin, e.wall, e.actor, e.action, e.detail, e.undoable ? 1 : 0, e.undone ? 1 : 0);
    },
    markUndone(id) { undo.run(id); },
    recent(limit) {
      return (recentStmt.all(sessionId, limit) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id), atMin: Number(r.at_min), wall: String(r.wall), actor: String(r.actor), action: String(r.action),
        detail: String(r.detail), undoable: r.undoable === 1, undone: r.undone === 1,
      }));
    },
    count() { return Number((countStmt.get(sessionId) as { n: number }).n); },
  };
}
