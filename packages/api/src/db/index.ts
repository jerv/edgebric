import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import path from "path";
import fs from "fs";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

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
  _sqlite = new Database(dbPath);

  // WAL mode for better concurrent read performance
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");

  // Load sqlite-vec extension for vector similarity search
  sqliteVec.load(_sqlite);

  _db = drizzle(_sqlite, { schema });
  const sqlite = _sqlite;

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
      status TEXT NOT NULL DEFAULT 'active',
      org_id TEXT NOT NULL,
      invited_by TEXT,
      last_login_at TEXT,
      auth_provider TEXT,
      auth_provider_sub TEXT,
      can_create_data_sources INTEGER DEFAULT 0,
      can_create_group_chats INTEGER DEFAULT 0,
      default_group_chat_notif_level TEXT DEFAULT 'all',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'organization',
      owner_id TEXT NOT NULL,
      org_id TEXT,
      dataset_name TEXT NOT NULL,
      document_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      access_mode TEXT NOT NULL DEFAULT 'all',
      avatar_url TEXT,
      allow_source_viewing INTEGER NOT NULL DEFAULT 1,
      allow_vault_sync INTEGER NOT NULL DEFAULT 1,
      allow_external_access INTEGER NOT NULL DEFAULT 1,
      pii_mode TEXT NOT NULL DEFAULT 'block',
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
      dataset_name TEXT,
      pii_warnings TEXT,
      data_source_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      source_document TEXT NOT NULL,
      document_name TEXT,
      section_path TEXT NOT NULL DEFAULT '[]',
      page_number INTEGER NOT NULL DEFAULT 0,
      heading TEXT NOT NULL DEFAULT '',
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      parent_content TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      user_name TEXT,
      org_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT,
      has_confident_answer INTEGER,
      answer_type TEXT,
      source TEXT,
      created_at TEXT NOT NULL
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
      org_id TEXT,
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
      group_chat_id TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_chunks_source_document ON chunks(source_document);
  `);

  // Migrate existing tables — add new columns if they don't exist yet
  const columnMigrations = [
    "ALTER TABLE conversations ADD COLUMN archived_at TEXT",
    "ALTER TABLE chunks ADD COLUMN content TEXT",
    "ALTER TABLE feedback ADD COLUMN comment TEXT",
    "ALTER TABLE messages ADD COLUMN source TEXT",
    "ALTER TABLE documents ADD COLUMN pii_warnings TEXT",
    "ALTER TABLE documents ADD COLUMN knowledge_base_id TEXT",
    "ALTER TABLE knowledge_bases ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'all'",
    "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN invited_by TEXT",
    // Multi-org: add org_id to data tables
    "ALTER TABLE conversations ADD COLUMN org_id TEXT",
    "ALTER TABLE knowledge_bases ADD COLUMN org_id TEXT",
    "ALTER TABLE feedback ADD COLUMN org_id TEXT",
    // Per-user data source creation permission
    "ALTER TABLE users ADD COLUMN can_create_kbs INTEGER DEFAULT 0",
    // Data source avatar
    "ALTER TABLE knowledge_bases ADD COLUMN avatar_url TEXT",
    // Per-source security toggles (default: all allowed)
    "ALTER TABLE knowledge_bases ADD COLUMN allow_source_viewing INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE knowledge_bases ADD COLUMN allow_vault_sync INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE knowledge_bases ADD COLUMN allow_external_access INTEGER NOT NULL DEFAULT 1",
    // Group chat permission
    "ALTER TABLE users ADD COLUMN can_create_group_chats INTEGER DEFAULT 0",
    // Default group chat notification level
    "ALTER TABLE users ADD COLUMN default_group_chat_notif_level TEXT DEFAULT 'all'",
    // OIDC provider tracking (for audit + provider migration)
    "ALTER TABLE users ADD COLUMN auth_provider TEXT",
    "ALTER TABLE users ADD COLUMN auth_provider_sub TEXT",
    // Group chat ID on notifications (for org-scoped filtering)
    "ALTER TABLE notifications ADD COLUMN group_chat_id TEXT",
    // Time-limited source sharing in group chats
    "ALTER TABLE group_chat_shared_kbs ADD COLUMN expires_at TEXT",
    // Parent chunk content for parent-child retrieval (larger context for LLM)
    "ALTER TABLE chunks ADD COLUMN parent_content TEXT",
    // ── KB → Data Source rename migrations ──────────────────────────────────
    // Table renames MUST come before column renames on the renamed tables
    "ALTER TABLE knowledge_bases RENAME TO data_sources",
    "ALTER TABLE kb_access RENAME TO data_source_access",
    "ALTER TABLE group_chat_shared_kbs RENAME TO group_chat_shared_data_sources",
    // Column renames (use new table names since tables were just renamed above)
    "ALTER TABLE documents RENAME COLUMN knowledge_base_id TO data_source_id",
    "ALTER TABLE data_source_access RENAME COLUMN kb_id TO data_source_id",
    "ALTER TABLE group_chat_shared_data_sources RENAME COLUMN knowledge_base_id TO data_source_id",
    "ALTER TABLE users RENAME COLUMN can_create_kbs TO can_create_data_sources",
    // ── Post-rename catch-up: ensure columns exist on data_sources ──────
    // If the table was already data_sources (not renamed from knowledge_bases),
    // earlier org_id/avatar_url/security toggle migrations targeted knowledge_bases and silently failed.
    "ALTER TABLE data_sources ADD COLUMN org_id TEXT",
    "ALTER TABLE data_sources ADD COLUMN avatar_url TEXT",
    "ALTER TABLE data_sources ADD COLUMN allow_source_viewing INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE data_sources ADD COLUMN allow_vault_sync INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE data_sources ADD COLUMN allow_external_access INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE data_sources ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'all'",
    "ALTER TABLE messages ADD COLUMN answer_type TEXT",
    "ALTER TABLE group_chat_messages ADD COLUMN answer_type TEXT",
    // Cloud connections refactor: add folder_sync_id to cloud_sync_files
    "ALTER TABLE cloud_sync_files ADD COLUMN folder_sync_id TEXT NOT NULL DEFAULT ''",
    // Per-source PII detection mode (off | warn | block)
    "ALTER TABLE data_sources ADD COLUMN pii_mode TEXT NOT NULL DEFAULT 'block'",
  ];
  for (const sql of columnMigrations) {
    try { sqlite.exec(sql); } catch { /* column already exists */ }
  }

  // New tables added after initial schema
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS data_source_access (
      id TEXT PRIMARY KEY,
      data_source_id TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_data_source_access_ds_id ON data_source_access(data_source_id);
    CREATE INDEX IF NOT EXISTS idx_data_source_access_email ON data_source_access(email);
  `);

  // Group chat tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS group_chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      creator_email TEXT NOT NULL,
      org_id TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      context_summary TEXT,
      context_summary_up_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_chat_members (
      group_chat_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_chat_id, user_email)
    );

    CREATE TABLE IF NOT EXISTS group_chat_shared_data_sources (
      id TEXT PRIMARY KEY,
      group_chat_id TEXT NOT NULL,
      data_source_id TEXT NOT NULL,
      shared_by_email TEXT NOT NULL,
      allow_source_viewing INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      shared_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_chat_messages (
      id TEXT PRIMARY KEY,
      group_chat_id TEXT NOT NULL,
      thread_parent_id TEXT,
      author_email TEXT,
      author_name TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT,
      has_confident_answer INTEGER,
      answer_type TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_chat_last_read (
      group_chat_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      last_read_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_chat_notif_prefs (
      group_chat_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'all'
    );

    CREATE INDEX IF NOT EXISTS idx_group_chat_members_email ON group_chat_members(user_email);
    CREATE INDEX IF NOT EXISTS idx_group_chat_messages_chat_id ON group_chat_messages(group_chat_id);
    CREATE INDEX IF NOT EXISTS idx_group_chat_messages_thread ON group_chat_messages(thread_parent_id);
    CREATE INDEX IF NOT EXISTS idx_group_chat_shared_ds_chat_id ON group_chat_shared_data_sources(group_chat_id);
    CREATE INDEX IF NOT EXISTS idx_group_chats_org_id ON group_chats(org_id);
    CREATE INDEX IF NOT EXISTS idx_group_chats_status ON group_chats(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_group_chat_last_read_pk ON group_chat_last_read(group_chat_id, user_email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_group_chat_notif_prefs_pk ON group_chat_notif_prefs(group_chat_id, user_email);
  `);

  // Mesh networking tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mesh_config (
      key TEXT PRIMARY KEY DEFAULT 'main',
      enabled INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'primary',
      primary_endpoint TEXT,
      mesh_token TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_name TEXT NOT NULL,
      group_id TEXT,
      org_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mesh_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'secondary',
      status TEXT NOT NULL DEFAULT 'offline',
      endpoint TEXT NOT NULL,
      group_id TEXT,
      source_count INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '0.0.0',
      org_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS node_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#3b82f6',
      org_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_mesh_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      assigned_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mesh_nodes_org_id ON mesh_nodes(org_id);
    CREATE INDEX IF NOT EXISTS idx_mesh_nodes_group_id ON mesh_nodes(group_id);
    CREATE INDEX IF NOT EXISTS idx_node_groups_org_id ON node_groups(org_id);
    CREATE INDEX IF NOT EXISTS idx_user_mesh_groups_user_id ON user_mesh_groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_mesh_groups_group_id ON user_mesh_groups(group_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_mesh_groups_unique ON user_mesh_groups(user_id, group_id);
  `);

  // Cloud storage integration tables
  sqlite.exec(`
    -- Cloud connections = OAuth credentials only (one per user per provider)
    CREATE TABLE IF NOT EXISTS cloud_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      org_id TEXT NOT NULL,
      account_email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cloud_oauth_tokens (
      connection_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT NOT NULL DEFAULT 'Bearer',
      expires_at TEXT,
      scopes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Folder syncs = link a cloud folder to a data source via a connection
    CREATE TABLE IF NOT EXISTS cloud_folder_syncs (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      data_source_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      sync_interval_min INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'active',
      last_sync_at TEXT,
      last_error TEXT,
      sync_cursor TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cloud_sync_files (
      id TEXT PRIMARY KEY,
      folder_sync_id TEXT NOT NULL,
      external_file_id TEXT NOT NULL,
      external_name TEXT NOT NULL,
      external_modified TEXT,
      document_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cloud_connections_org_id ON cloud_connections(org_id);
    CREATE INDEX IF NOT EXISTS idx_cloud_connections_status ON cloud_connections(status);
    CREATE INDEX IF NOT EXISTS idx_cloud_folder_syncs_connection_id ON cloud_folder_syncs(connection_id);
    CREATE INDEX IF NOT EXISTS idx_cloud_folder_syncs_data_source_id ON cloud_folder_syncs(data_source_id);
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_files_folder_sync_id ON cloud_sync_files(folder_sync_id);
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_files_external_file_id ON cloud_sync_files(external_file_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_sync_files_sync_ext ON cloud_sync_files(folder_sync_id, external_file_id);
  `);

  // FTS5 full-text search index for hybrid BM25+vector retrieval
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED,
      content,
      tokenize='porter unicode61'
    );
  `);

  // sqlite-vec virtual table for vector similarity search
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[${config.inference.embeddingDim}]
    );
  `);

  // Audit log (immutable, hash-chained)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_email TEXT,
      actor_ip TEXT,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_email);
  `);

  // Multi-org: create indexes on new org_id columns
  try {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_org_id ON conversations(org_id);
      CREATE INDEX IF NOT EXISTS idx_data_sources_org_id ON data_sources(org_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_org_id ON feedback(org_id);
    `);
  } catch { /* indexes already exist */ }

  // Multi-org: backfill org_id on existing rows using the default org
  try {
    const defaultOrg = sqlite.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: string } | undefined;
    if (defaultOrg) {
      const tables = ["conversations", "data_sources", "feedback"] as const;
      for (const table of tables) {
        sqlite.prepare(`UPDATE ${table} SET org_id = ? WHERE org_id IS NULL`).run(defaultOrg.id);
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

/** Get the raw better-sqlite3 instance (needed for FTS5 and other features Drizzle doesn't support). */
export function getSqlite(): InstanceType<typeof Database> {
  if (!_sqlite) throw new Error("Database not initialized — call initDatabase() first");
  return _sqlite;
}

/** Close the database connection (for graceful shutdown). */
export function closeDatabase(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
