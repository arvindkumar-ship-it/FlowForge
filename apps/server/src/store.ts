import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FlowError, type Graph, type Snapshot } from '../../../packages/core/src/model';
export type Workflow = { id: string; name: string; project_id: string; active: number; version: number; graph: string; updated_at: number; archived: number };
export type Run = { id: string; workflow_id: string; version: number; graph: string; input: string; status: string; mode: string; created_at: number; finished_at: number | null; snapshot: string | null; error: string | null; wait_until: number; lease: string | null; lease_until: number; attempts: number; project_id: string };
/** Durable single-host repository. WAL is not a distributed queue. */
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT OR IGNORE INTO projects VALUES('default','Personal workspace');
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),project_id TEXT NOT NULL REFERENCES projects(id));
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,name TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),active INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL,graph TEXT NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS versions(workflow_id TEXT NOT NULL REFERENCES workflows(id),version INTEGER NOT NULL,graph TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workflow_id,version));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL REFERENCES workflows(id),version INTEGER NOT NULL,graph TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,mode TEXT NOT NULL,created_at INTEGER NOT NULL,finished_at INTEGER,snapshot TEXT,error TEXT,wait_until INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,project_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_ready ON runs(status,wait_until,created_at);
      CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS dedupe(scope TEXT NOT NULL,key TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),expires_at INTEGER NOT NULL,PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,name TEXT NOT NULL,project_id TEXT NOT NULL,type TEXT NOT NULL,host TEXT NOT NULL,envelope TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  }
  /** Synchronous transaction with rollback on any failed statement. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** Record metadata only; never log credentials, input, or node output. */
  audit(actor: string, action: string, resource: string) { this.db.prepare('INSERT INTO audit(actor,action,resource,created_at) VALUES(?,?,?,?)').run(actor, action, resource, Date.now()); }
  /** Save immutable revisions under optimistic concurrency control. */
  saveWorkflow(project: string, actor: string, name: string, graph: Graph, id: string = randomUUID(), expected?: number): Workflow {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM workflows WHERE id=?').get(id) as Workflow | undefined;
      if (old && old.project_id !== project) throw new FlowError('NOT_FOUND', 'Workflow not found', 404);
      if (old && old.version !== expected) throw new FlowError('CONFLICT', 'Workflow changed; reload before saving', 409);
      const version = (old?.version ?? 0) + 1; const now = Date.now(); const encoded = JSON.stringify(graph);
      this.db.prepare('INSERT INTO workflows(id,name,project_id,version,graph,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,graph=excluded.graph,updated_at=excluded.updated_at').run(id, name, project, version, encoded, now);
      this.db.prepare('INSERT INTO versions VALUES(?,?,?,?)').run(id, version, encoded, now); this.audit(actor, 'workflow.save', id);
      return this.db.prepare('SELECT * FROM workflows WHERE id=?').get(id) as Workflow;
    });
  }
  /** Atomically acknowledge only persisted jobs and idempotency records. */
  enqueue(w: Workflow, input: unknown, mode: string, key?: string, highWater = 1000): { id: string; duplicate: boolean } {
    return this.transaction(() => {
      const scope = `${w.id}:${mode}`; const now = Date.now();
      this.db.prepare('DELETE FROM dedupe WHERE expires_at < ?').run(now);
      const duplicate = key ? this.db.prepare('SELECT run_id FROM dedupe WHERE scope=? AND key=?').get(scope, key) as { run_id: string } | undefined : undefined;
      if (duplicate) return { id: duplicate.run_id, duplicate: true };
      const pending = this.db.prepare("SELECT count(*) AS n FROM runs WHERE status='queued'").get() as { n: number };
      if (pending.n >= highWater) throw new FlowError('OVERLOADED', 'Queue is full; retry later', 503);
      const id = randomUUID();
      this.db.prepare("INSERT INTO runs(id,workflow_id,version,graph,input,status,mode,created_at,project_id) VALUES(?,?,?,?,?,'queued',?,?,?)").run(id, w.id, w.version, w.graph, JSON.stringify(input), mode, now, w.project_id);
      if (key) this.db.prepare('INSERT INTO dedupe VALUES(?,?,?,?)').run(scope, key, id, now + 86400_000);
      this.db.prepare('INSERT INTO outbox(run_id,status,created_at) VALUES(?,?,?)').run(id, 'queued', now);
      return { id, duplicate: false };
    });
  }
  /** Claim one ready execution with a fencing token, recovering expired leases. */
  claim(): Run | undefined {
    return this.transaction(() => {
      const now = Date.now();
      const expired = this.db.prepare("SELECT id,attempts FROM runs WHERE status='running' AND lease_until < ?").all(now) as { id: string; attempts: number }[];
      for (const row of expired) {
        const status = row.attempts >= 3 ? 'crashed' : 'queued';
        this.db.prepare('UPDATE runs SET status=?,lease=NULL,error=?,finished_at=? WHERE id=?').run(status, 'Worker lease expired; external effects may have occurred', status === 'crashed' ? now : null, row.id);
        this.db.prepare('INSERT INTO outbox(run_id,status,created_at) VALUES(?,?,?)').run(row.id, status, now);
      }
      const row = this.db.prepare("SELECT * FROM runs WHERE status='queued' OR (status='waiting' AND wait_until <= ?) ORDER BY CASE mode WHEN 'manual' THEN 0 ELSE 1 END, created_at LIMIT 1").get(now) as Run | undefined;
      if (!row) return;
      const lease = randomUUID();
      this.db.prepare("UPDATE runs SET status='running',lease=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(lease, now + 90_000, row.id);
      this.db.prepare('INSERT INTO outbox(run_id,status,created_at) VALUES(?,?,?)').run(row.id, 'running', now);
      return { ...row, status: 'running', lease, attempts: row.attempts + 1 };
    });
  }
  /** Fence stale workers and persist each completed node snapshot. */
  checkpoint(run: Run, snapshot: Snapshot) {
    const r = this.db.prepare("UPDATE runs SET snapshot=? WHERE id=? AND lease=? AND status='running'").run(JSON.stringify(snapshot), run.id, run.lease);
    if (!r.changes) throw new FlowError('LEASE_LOST', 'Execution lease is no longer valid', 409);
  }
  /** Commit execution state and its event in the same transaction. */
  finish(run: Run, status: string, waitUntil = 0, error: string | null = null) {
    this.transaction(() => {
      const r = this.db.prepare("UPDATE runs SET status=?,wait_until=?,finished_at=?,error=?,lease=NULL WHERE id=? AND lease=? AND status='running'").run(status, waitUntil, status === 'waiting' ? null : Date.now(), error, run.id, run.lease);
      if (r.changes) this.db.prepare('INSERT INTO outbox(run_id,status,created_at) VALUES(?,?,?)').run(run.id, status, Date.now());
    });
  }
}
