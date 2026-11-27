import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config, REPO_ROOT } from './config.js';
import { nowMs } from './util.js';

export type Db = DatabaseSync;

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'server-node', 'migrations');

export function openDatabase(): Db {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  // WAL + 外键：任务要求。数据库文件位于独立 data/ 目录，不随代码更新被覆盖。
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  applyMigrations(db);
  return db;
}

function applyMigrations(db: Db): void {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  // 空库时该表由 001 迁移本身创建，查询前必须先判断，否则首次启动会失败。
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();
  const applied = tableExists
    ? (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
    : [];
  const done = new Set(applied.map((r) => Number(r.version)));
  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0], 10);
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, nowMs());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${String(error)}`);
    }
  }
}

/**
 * SQLite 单事务。所有发奖 / 扣费 / 强化必须经此函数，
 * 保证不会出现「扣了材料但武器没更新」的半完成状态。
 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  }
}

export function one<T = any>(db: Db, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T = any>(db: Db, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: Db, sql: string, ...params: any[]): void {
  db.prepare(sql).run(...params);
}
