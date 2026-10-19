import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'chat.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL,
      password_hash TEXT NOT NULL, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT 'Hey there! I am using WhatsApp Clone.',
      color TEXT NOT NULL DEFAULT '#008069', avatar_id TEXT, last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('direct','group')),
      name TEXT, owner_id TEXT REFERENCES users(id), direct_key TEXT UNIQUE, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_id INTEGER NOT NULL DEFAULT 0, delivered_id INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(chat_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), chat_id TEXT REFERENCES chats(id),
      purpose TEXT NOT NULL, filename TEXT NOT NULL, disk_name TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'text', attachment_id TEXT REFERENCES attachments(id),
      reply_id INTEGER REFERENCES messages(id), client_id TEXT, created_at INTEGER NOT NULL,
      edited_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(sender_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS messages_chat_id ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS stars (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, PRIMARY KEY(user_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL,
      color TEXT NOT NULL, attachment_id TEXT REFERENCES attachments(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS status_views (
      status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), viewed_at INTEGER NOT NULL, PRIMARY KEY(status_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      user_id TEXT NOT NULL REFERENCES users(id), blocked_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(user_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
      caller_id TEXT NOT NULL REFERENCES users(id), callee_id TEXT NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, accepted_at INTEGER, ended_at INTEGER
    );
    PRAGMA user_version = 1;
  `);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
