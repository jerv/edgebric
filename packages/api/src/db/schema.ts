import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Organizations ──────────────────────────────────────────────────────────

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  plan: text("plan").notNull().default("free"), // free | pro | enterprise
  settings: text("settings").notNull().default("{}"), // JSON
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  role: text("role").notNull().default("member"), // owner | admin | member
  status: text("status").notNull().default("active"), // active | invited
  orgId: text("org_id").notNull(),
  invitedBy: text("invited_by"),
  lastLoginAt: text("last_login_at"),
  authProvider: text("auth_provider"), // "google" | "microsoft" | "okta" | "onelogin" | "ping" | "generic"
  authProviderSub: text("auth_provider_sub"), // provider's unique sub claim
  canCreateDataSources: integer("can_create_data_sources").default(0), // 0 = no, 1 = yes
  canCreateGroupChats: integer("can_create_group_chats").default(0), // 0 = no, 1 = yes
  defaultGroupChatNotifLevel: text("default_group_chat_notif_level").default("all"), // "all" | "mentions" | "none"
  createdAt: text("created_at").notNull(),
});

// ─── Data Sources ──────────────────────────────────────────────────────────

export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("organization"), // organization | personal
  ownerId: text("owner_id").notNull(),
  orgId: text("org_id"),
  datasetName: text("dataset_name").notNull(),
  documentCount: integer("document_count").notNull().default(0),
  status: text("status").notNull().default("active"), // active | archived
  accessMode: text("access_mode").notNull().default("all"), // all | restricted
  avatarUrl: text("avatar_url"),
  // Per-source security toggles (1 = allowed, 0 = blocked; default: all allowed)
  allowSourceViewing: integer("allow_source_viewing").notNull().default(1),
  allowVaultSync: integer("allow_vault_sync").notNull().default(1),
  allowExternalAccess: integer("allow_external_access").notNull().default(0),
  piiMode: text("pii_mode").notNull().default("block"), // off | warn | block
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Data Source Access (for restricted sources) ────────────────────────────

export const dataSourceAccess = sqliteTable("data_source_access", {
  id: text("id").primaryKey(),
  dataSourceId: text("data_source_id").notNull(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull(),
});

// ─── Documents ────────────────────────────────────────────────────────────────

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // pdf | docx | txt | md
  classification: text("classification").notNull().default("policy"),
  uploadedAt: text("uploaded_at").notNull(), // ISO string
  updatedAt: text("updated_at").notNull(),
  status: text("status").notNull().default("processing"), // processing | ready | failed
  pageCount: integer("page_count"),
  sectionHeadings: text("section_headings").notNull().default("[]"), // JSON array
  storageKey: text("storage_key").notNull(),
  datasetName: text("dataset_name"),
  piiWarnings: text("pii_warnings"), // JSON array of PIIWarning, null = none detected
  dataSourceId: text("data_source_id"), // FK to data_sources.id
});

// ─── Chunk Registry ──────────────────────────────────────────────────────────

export const chunks = sqliteTable("chunks", {
  // Sequential chunkId, e.g. "knowledge-base-0"
  chunkId: text("chunk_id").primaryKey(),
  sourceDocument: text("source_document").notNull(),
  documentName: text("document_name"),
  sectionPath: text("section_path").notNull().default("[]"), // JSON array
  pageNumber: integer("page_number").notNull().default(0),
  heading: text("heading").notNull().default(""),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content"), // chunk text for Vault Mode sync
  parentContent: text("parent_content"), // larger context chunk for LLM (parent-child retrieval)
});

// ─── Conversations ──────────────────────────────────────────────────────────

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  userName: text("user_name"),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
});

// ─── Messages ───────────────────────────────────────────────────────────────

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: text("citations"),
  hasConfidentAnswer: integer("has_confident_answer"),
  answerType: text("answer_type"), // "grounded" | "blended" | "general" | "blocked" | null
  source: text("source"), // "ai" | "admin" | "system" | null (null = "ai")
  toolUses: text("tool_uses"), // JSON array of tool use records
  createdAt: text("created_at").notNull(),
});

// ─── Notifications ──────────────────────────────────────────────────────────

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  type: text("type").notNull(), // "group_chat_invite" | "group_chat_message" | "group_chat_mention" | "source_shared" | "chat_expiring"
  conversationId: text("conversation_id").notNull(),
  groupChatId: text("group_chat_id"), // set for group chat notifications
  messageId: text("message_id"),
  title: text("title").notNull(),
  body: text("body"),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull(),
});

// ─── Feedback ────────────────────────────────────────────────────────────────

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id").notNull(),
  rating: text("rating").notNull(), // "up" | "down"
  messageSnapshot: text("message_snapshot").notNull(), // JSON array of {role, content}
  topic: text("topic"),
  comment: text("comment"), // optional note from user on thumbs-down
  orgId: text("org_id"),
  createdAt: text("created_at").notNull(),
});

// ─── Question Resolutions ───────────────────────────────────────────────────

export const questionResolutions = sqliteTable("question_resolutions", {
  messageId: text("message_id").primaryKey(), // assistant message id
  resolvedAt: text("resolved_at").notNull(),
  resolvedBy: text("resolved_by"),
});

// ─── Group Chats ──────────────────────────────────────────────────────────────

export const groupChats = sqliteTable("group_chats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  creatorEmail: text("creator_email").notNull(),
  orgId: text("org_id").notNull(),
  expiresAt: text("expires_at"), // ISO string; NULL = never
  status: text("status").notNull().default("active"), // active | expired | archived
  contextSummary: text("context_summary"), // cached LLM summary of older messages
  contextSummaryUpTo: text("context_summary_up_to"), // message ID the summary covers through
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const groupChatMembers = sqliteTable("group_chat_members", {
  groupChatId: text("group_chat_id").notNull(),
  userEmail: text("user_email").notNull(),
  userName: text("user_name"),
  role: text("role").notNull().default("member"), // creator | member
  joinedAt: text("joined_at").notNull(),
});

export const groupChatSharedDataSources = sqliteTable("group_chat_shared_data_sources", {
  id: text("id").primaryKey(),
  groupChatId: text("group_chat_id").notNull(),
  dataSourceId: text("data_source_id").notNull(),
  sharedByEmail: text("shared_by_email").notNull(),
  allowSourceViewing: integer("allow_source_viewing").notNull().default(1),
  expiresAt: text("expires_at"), // ISO string; NULL = permanent (no expiration)
  sharedAt: text("shared_at").notNull(),
});

export const groupChatMessages = sqliteTable("group_chat_messages", {
  id: text("id").primaryKey(),
  groupChatId: text("group_chat_id").notNull(),
  threadParentId: text("thread_parent_id"), // NULL = main chat, set = thread reply
  authorEmail: text("author_email"), // NULL for bot messages
  authorName: text("author_name"),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull(),
  citations: text("citations"), // JSON array
  hasConfidentAnswer: integer("has_confident_answer"),
  answerType: text("answer_type"), // "grounded" | "blended" | "general" | "blocked" | null
  createdAt: text("created_at").notNull(),
});

// ─── Group Chat Last Read (unread tracking) ─────────────────────────────────

export const groupChatLastRead = sqliteTable("group_chat_last_read", {
  groupChatId: text("group_chat_id").notNull(),
  userEmail: text("user_email").notNull(),
  lastReadAt: text("last_read_at").notNull(), // ISO timestamp of last read
});

// ─── Group Chat Notification Preferences ────────────────────────────────────

export const groupChatNotifPrefs = sqliteTable("group_chat_notif_prefs", {
  groupChatId: text("group_chat_id").notNull(),
  userEmail: text("user_email").notNull(),
  level: text("level").notNull().default("all"), // "all" | "mentions" | "none"
});

// ─── Audit Log (immutable, hash-chained) ─────────────────────────────────────

export const auditLog = sqliteTable("audit_log", {
  seq: integer("seq").primaryKey({ autoIncrement: true }), // monotonic sequence
  id: text("id").notNull(), // UUID
  timestamp: text("timestamp").notNull(), // ISO 8601
  eventType: text("event_type").notNull(), // e.g. "auth.login", "document.upload"
  actorEmail: text("actor_email"), // who performed the action (NULL for system events)
  actorIp: text("actor_ip"), // client IP address
  resourceType: text("resource_type"), // e.g. "document", "data_source", "user"
  resourceId: text("resource_id"), // ID of the affected resource
  details: text("details"), // JSON object with event-specific data
  prevHash: text("prev_hash").notNull(), // SHA-256 of previous entry (chain)
  hash: text("hash").notNull(), // SHA-256 of this entry
});

// ─── Mesh Networking ─────────────────────────────────────────────────────────

export const meshConfig = sqliteTable("mesh_config", {
  key: text("key").primaryKey().default("main"), // single-row table
  enabled: integer("enabled").notNull().default(0), // 0 = disabled, 1 = enabled
  role: text("role").notNull().default("primary"), // primary | secondary
  primaryEndpoint: text("primary_endpoint"), // null if this IS the primary
  meshToken: text("mesh_token").notNull(),
  nodeId: text("node_id").notNull(),
  nodeName: text("node_name").notNull(),
  groupId: text("group_id"), // FK to node_groups.id
  orgId: text("org_id").notNull(),
});

export const meshNodes = sqliteTable("mesh_nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("secondary"), // primary | secondary
  status: text("status").notNull().default("offline"), // online | offline | connecting
  endpoint: text("endpoint").notNull(),
  groupId: text("group_id"), // FK to node_groups.id
  sourceCount: integer("source_count").notNull().default(0),
  lastSeen: text("last_seen").notNull(),
  version: text("version").notNull().default("0.0.0"),
  orgId: text("org_id").notNull(),
});

export const nodeGroups = sqliteTable("node_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#3b82f6"), // blue default
  orgId: text("org_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Maps users to mesh node groups for access control. Users can only search nodes in their assigned groups. */
export const userMeshGroups = sqliteTable("user_mesh_groups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(), // FK to users.id
  groupId: text("group_id").notNull(), // FK to node_groups.id
  orgId: text("org_id").notNull(),
  assignedAt: text("assigned_at").notNull(),
  assignedBy: text("assigned_by").notNull(), // email of admin who assigned
});

// ─── Integration Config ──────────────────────────────────────────────────────

export const integrationConfig = sqliteTable("integration_config", {
  // Single-row table — always key = "main"
  key: text("key").primaryKey().default("main"),
  config: text("config").notNull().default("{}"), // JSON blob
});

// ─── API Keys ──────────────────────────────────────────────────────────────

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  orgId: text("org_id").notNull(),
  permission: text("permission").notNull().default("read"), // read | read-write | admin
  sourceScope: text("source_scope").notNull().default("all"), // "all" or JSON array of source IDs
  rateLimit: integer("rate_limit").notNull().default(300),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revoked: integer("revoked").notNull().default(0),
});

// ─── Webhooks ─────────────────────────────────────────────────────────────

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events").notNull().default("[]"), // JSON array of event types
  orgId: text("org_id").notNull(),
  apiKeyId: text("api_key_id").notNull(), // FK to api_keys.id
  createdAt: text("created_at").notNull(),
});

// ─── Source Summaries (cached AI-generated summaries) ─────────────────────

export const sourceSummaries = sqliteTable("source_summaries", {
  dataSourceId: text("data_source_id").primaryKey(), // FK to data_sources.id
  summary: text("summary").notNull(),
  topTopics: text("top_topics").notNull().default("[]"), // JSON array of strings
  documentCount: integer("document_count").notNull().default(0),
  generatedAt: text("generated_at").notNull(),
  sourceUpdatedAt: text("source_updated_at").notNull(), // snapshot of data_sources.updated_at — regenerate if changed
});

// ─── Cloud Storage Integrations ─────────────────────────────────────────────

export const cloudConnections = sqliteTable("cloud_connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(), // google_drive | onedrive | dropbox | notion | confluence
  displayName: text("display_name").notNull(),
  orgId: text("org_id").notNull(),
  accountEmail: text("account_email"),
  status: text("status").notNull().default("active"), // active | disconnected
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const cloudFolderSyncs = sqliteTable("cloud_folder_syncs", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(), // FK to cloud_connections.id
  dataSourceId: text("data_source_id").notNull(), // FK to data_sources.id
  folderId: text("folder_id").notNull(),
  folderName: text("folder_name").notNull(),
  syncIntervalMin: integer("sync_interval_min").notNull().default(60),
  status: text("status").notNull().default("active"), // active | paused | error
  lastSyncAt: text("last_sync_at"),
  lastError: text("last_error"),
  syncCursor: text("sync_cursor"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const cloudOauthTokens = sqliteTable("cloud_oauth_tokens", {
  connectionId: text("connection_id").primaryKey(), // FK to cloud_connections.id
  accessToken: text("access_token").notNull(), // encrypted via encryptText()
  refreshToken: text("refresh_token"), // encrypted via encryptText()
  tokenType: text("token_type").notNull().default("Bearer"),
  expiresAt: text("expires_at"),
  scopes: text("scopes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Telegram Bot ─────────────────────────────────────────────────────────────

/** Links a Telegram user to an Edgebric user account. */
export const telegramLinks = sqliteTable("telegram_links", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  edgebricUserId: text("edgebric_user_id").notNull(), // FK to users.id
  telegramUsername: text("telegram_username"),
  linkedAt: text("linked_at").notNull(),
});

/** Temporary link codes for pairing Telegram accounts (10-minute expiry). */
export const telegramLinkCodes = sqliteTable("telegram_link_codes", {
  code: text("code").primaryKey(), // 6-digit code
  userId: text("user_id").notNull(), // FK to users.id
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const cloudSyncFiles = sqliteTable("cloud_sync_files", {
  id: text("id").primaryKey(),
  folderSyncId: text("folder_sync_id").notNull(), // FK to cloud_folder_syncs.id
  externalFileId: text("external_file_id").notNull(),
  externalName: text("external_name").notNull(),
  externalModified: text("external_modified"),
  documentId: text("document_id"), // FK to documents.id (null until first successful ingest)
  status: text("status").notNull().default("pending"), // pending | synced | error | deleted
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
