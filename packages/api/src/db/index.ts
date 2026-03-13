import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import path from "path";
import fs from "fs";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Initialize the SQLite database.
 *
 * The DB file lives at DATA_DIR/edgebric.db — a sysadmin controls where
 * data is stored by setting the DATA_DIR environment variable (defaults to ./data).
 */
export function initDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  // Ensure data directory exists
  fs.mkdirSync(config.dataDir, { recursive: true });

  const dbPath = path.join(config.dataDir, "edgebric.db");
  const sqlite = new Database(dbPath);

  // WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });

  // Create tables if they don't exist (push-style — no migration files needed)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      org_id TEXT NOT NULL,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'organization',
      owner_id TEXT NOT NULL,
      dataset_name TEXT NOT NULL,
      document_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'policy',
      uploaded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      page_count INTEGER,
      section_headings TEXT NOT NULL DEFAULT '[]',
      storage_key TEXT NOT NULL,
      dataset_name TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      source_document TEXT NOT NULL,
      document_name TEXT,
      section_path TEXT NOT NULL DEFAULT '[]',
      page_number INTEGER NOT NULL DEFAULT 0,
      heading TEXT NOT NULL DEFAULT '',
      chunk_index INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      user_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT,
      has_confident_answer INTEGER,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalation_targets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      slack_user_id TEXT,
      email TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      question TEXT NOT NULL,
      ai_answer TEXT NOT NULL,
      source_citations TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      notified_via TEXT,
      conversation_id TEXT,
      message_id TEXT,
      target_id TEXT,
      target_name TEXT,
      method TEXT,
      read_at TEXT,
      read_by TEXT,
      admin_reply TEXT,
      replied_at TEXT,
      replied_by TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      reply_message_id TEXT
    );

    CREATE TABLE IF NOT EXISTS integration_config (
      key TEXT PRIMARY KEY DEFAULT 'main',
      config TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      message_snapshot TEXT NOT NULL,
      topic TEXT,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_resolutions (
      message_id TEXT PRIMARY KEY,
      resolved_at TEXT NOT NULL,
      resolved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      type TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      escalation_id TEXT,
      message_id TEXT,
      title TEXT NOT NULL,
      body TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_email ON conversations(user_email);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_conversation_id ON feedback(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
    CREATE INDEX IF NOT EXISTS idx_feedback_topic ON feedback(topic);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_email ON notifications(user_email);
    CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
  `);

  // Migrate existing escalations table — add new columns if they don't exist yet
  const columnMigrations = [
    "ALTER TABLE escalations ADD COLUMN conversation_id TEXT",
    "ALTER TABLE escalations ADD COLUMN message_id TEXT",
    "ALTER TABLE escalations ADD COLUMN target_id TEXT",
    "ALTER TABLE escalations ADD COLUMN target_name TEXT",
    "ALTER TABLE escalations ADD COLUMN method TEXT",
    "ALTER TABLE escalations ADD COLUMN read_at TEXT",
    "ALTER TABLE escalations ADD COLUMN read_by TEXT",
    "ALTER TABLE conversations ADD COLUMN archived_at TEXT",
    "ALTER TABLE chunks ADD COLUMN content TEXT",
    "ALTER TABLE feedback ADD COLUMN comment TEXT",
    "ALTER TABLE messages ADD COLUMN source TEXT",
    "ALTER TABLE escalations ADD COLUMN admin_reply TEXT",
    "ALTER TABLE escalations ADD COLUMN replied_at TEXT",
    "ALTER TABLE escalations ADD COLUMN replied_by TEXT",
    "ALTER TABLE escalations ADD COLUMN resolved_at TEXT",
    "ALTER TABLE escalations ADD COLUMN resolved_by TEXT",
    "ALTER TABLE escalations ADD COLUMN reply_message_id TEXT",
    "ALTER TABLE documents ADD COLUMN pii_warnings TEXT",
    "ALTER TABLE documents ADD COLUMN knowledge_base_id TEXT",
    "ALTER TABLE knowledge_bases ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'all'",
    "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN invited_by TEXT",
    // Multi-org: add org_id to data tables
    "ALTER TABLE conversations ADD COLUMN org_id TEXT",
    "ALTER TABLE escalations ADD COLUMN org_id TEXT",
    "ALTER TABLE escalation_targets ADD COLUMN org_id TEXT",
    "ALTER TABLE knowledge_bases ADD COLUMN org_id TEXT",
    "ALTER TABLE feedback ADD COLUMN org_id TEXT",
    // Per-target notification method toggles
    "ALTER TABLE escalation_targets ADD COLUMN slack_notify INTEGER",
    "ALTER TABLE escalation_targets ADD COLUMN email_notify INTEGER",
  ];
  for (const sql of columnMigrations) {
    try { sqlite.exec(sql); } catch { /* column already exists */ }
  }

  // New tables added after initial schema
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS kb_access (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_access_kb_id ON kb_access(kb_id);
    CREATE INDEX IF NOT EXISTS idx_kb_access_email ON kb_access(email);
  `);

  // Create index after migration ensures the column exists
  try {
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_escalations_conversation_id ON escalations(conversation_id)");
  } catch { /* index already exists or column missing */ }

  // Multi-org: create indexes on new org_id columns
  try {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_org_id ON conversations(org_id);
      CREATE INDEX IF NOT EXISTS idx_escalations_org_id ON escalations(org_id);
      CREATE INDEX IF NOT EXISTS idx_escalation_targets_org_id ON escalation_targets(org_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_bases_org_id ON knowledge_bases(org_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_org_id ON feedback(org_id);
    `);
  } catch { /* indexes already exist */ }

  // Multi-org: backfill org_id on existing rows using the default org
  try {
    const defaultOrg = sqlite.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: string } | undefined;
    if (defaultOrg) {
      const tables = ["conversations", "escalations", "escalation_targets", "knowledge_bases", "feedback"];
      for (const table of tables) {
        sqlite.exec(`UPDATE ${table} SET org_id = '${defaultOrg.id}' WHERE org_id IS NULL`);
      }
    }
  } catch { /* backfill already done or no default org yet */ }

  logger.info({ dbPath }, "Database initialized");
  return _db;
}

/** Get the database instance (must call initDatabase first). */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) throw new Error("Database not initialized — call initDatabase() first");
  return _db;
}
