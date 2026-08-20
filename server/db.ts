import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dataPath } from './config.js'

const databaseFile = path.join(dataPath, 'loadchat.sqlite')
const pendingRestore = path.join(dataPath, 'restore-pending.sqlite')

if (fs.existsSync(pendingRestore)) {
  const candidate = new DatabaseSync(pendingRestore)
  const integrity = candidate.prepare('PRAGMA integrity_check').get() as { integrity_check?: string }
  candidate.close()
  if (integrity?.integrity_check !== 'ok') throw new Error('待恢复的数据库完整性检查失败')
  const backupsPath = path.join(dataPath, 'backups')
  fs.mkdirSync(backupsPath, { recursive: true })
  if (fs.existsSync(databaseFile)) fs.copyFileSync(databaseFile, path.join(backupsPath, `pre-restore-${Date.now()}.sqlite`))
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databaseFile}${suffix}`, { force: true })
  fs.renameSync(pendingRestore, databaseFile)
}

export const db = new DatabaseSync(databaseFile)
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, nickname TEXT NOT NULL, device_name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '', last_ip TEXT NOT NULL DEFAULT '', last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('group','direct')),
    creator_id TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL, device_id TEXT NOT NULL,
    PRIMARY KEY(room_id, device_id), FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, upload_key TEXT UNIQUE, original_name TEXT NOT NULL, stored_name TEXT NOT NULL,
    mime TEXT NOT NULL, size INTEGER NOT NULL, chunk_size INTEGER NOT NULL, total_chunks INTEGER NOT NULL,
    sender_id TEXT NOT NULL, room_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS file_chunks (
    file_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, size INTEGER NOT NULL,
    PRIMARY KEY(file_id, chunk_index), FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT NOT NULL,
    type TEXT NOT NULL, content TEXT NOT NULL, file_id TEXT, created_at INTEGER NOT NULL,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at DESC);
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
  );
`)

function addColumn(table: string, name: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

addColumn('devices', 'auth_hash', "TEXT NOT NULL DEFAULT ''")
addColumn('devices', 'approved', 'INTEGER NOT NULL DEFAULT 1')
addColumn('devices', 'blocked', 'INTEGER NOT NULL DEFAULT 0')
addColumn('devices', 'first_seen', 'INTEGER NOT NULL DEFAULT 0')
addColumn('devices', 'approved_at', 'INTEGER')
addColumn('devices', 'approved_by', 'TEXT')
addColumn('devices', 'encryption_public_key', "TEXT NOT NULL DEFAULT ''")
addColumn('room_members', 'role', "TEXT NOT NULL DEFAULT 'member'")
addColumn('files', 'sha256', "TEXT NOT NULL DEFAULT ''")
addColumn('messages', 'reply_to', 'TEXT')
addColumn('messages', 'edited_at', 'INTEGER')
addColumn('messages', 'deleted_at', 'INTEGER')

db.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL, device_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(message_id, device_id, emoji), FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS read_receipts (
    room_id TEXT NOT NULL, device_id TEXT NOT NULL, last_read_at INTEGER NOT NULL,
    PRIMARY KEY(room_id, device_id)
  );
  CREATE TABLE IF NOT EXISTS file_shares (
    id TEXT PRIMARY KEY, file_id TEXT NOT NULL, creator_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    max_downloads INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER, created_at INTEGER NOT NULL,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shares_file ON file_shares(file_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
`)
db.exec("UPDATE room_members SET role='admin' WHERE EXISTS (SELECT 1 FROM rooms r WHERE r.id=room_members.room_id AND r.creator_id=room_members.device_id)")
db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?,?)').run(3, Date.now())

export const databasePath = databaseFile

export function row<T>(statement: string, ...params: any[]) {
  return db.prepare(statement).get(...params) as T | undefined
}

export function rows<T>(statement: string, ...params: any[]) {
  return db.prepare(statement).all(...params) as T[]
}

export function run(statement: string, ...params: any[]) {
  return db.prepare(statement).run(...params)
}
