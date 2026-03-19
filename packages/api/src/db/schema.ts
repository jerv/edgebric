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
  canCreateKBs: integer("can_create_kbs").default(0), // 0 = no, 1 = yes
  canCreateGroupChats: integer("can_create_group_chats").default(0), // 0 = no, 1 = yes
  createdAt: text("created_at").notNull(),
});

// ─── Knowledge Bases ──────────────────────────────────────────────────────────

export const knowledgeBases = sqliteTable("knowledge_bases", {
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
  // Per-KB security toggles (1 = allowed, 0 = blocked; default: all allowed)
  allowSourceViewing: integer("allow_source_viewing").notNull().default(1),
  allowVaultSync: integer("allow_vault_sync").notNull().default(1),
  allowExternalAccess: integer("allow_external_access").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── KB Access (for restricted KBs) ────────────────────────────────────────

export const kbAccess = sqliteTable("kb_access", {
  id: text("id").primaryKey(),
  kbId: text("kb_id").notNull(),
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
  knowledgeBaseId: text("knowledge_base_id"), // FK to knowledge_bases.id
});

// ─── Chunk Registry ──────────────────────────────────────────────────────────

export const chunks = sqliteTable("chunks", {
  // mKB-assigned chunkId, e.g. "knowledge-base-0"
  chunkId: text("chunk_id").primaryKey(),
  sourceDocument: text("source_document").notNull(),
  documentName: text("document_name"),
  sectionPath: text("section_path").notNull().default("[]"), // JSON array
  pageNumber: integer("page_number").notNull().default(0),
  heading: text("heading").notNull().default(""),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content"), // chunk text for Vault Mode sync
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
  source: text("source"), // "ai" | "admin" | "system" | null (null = "ai")
  createdAt: text("created_at").notNull(),
});

// ─── Notifications ──────────────────────────────────────────────────────────

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  type: text("type").notNull(), // "group_chat_invite" | "source_shared" | "chat_expiring"
  conversationId: text("conversation_id").notNull(),
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

export const groupChatSharedKBs = sqliteTable("group_chat_shared_kbs", {
  id: text("id").primaryKey(),
  groupChatId: text("group_chat_id").notNull(),
  knowledgeBaseId: text("knowledge_base_id").notNull(),
  sharedByEmail: text("shared_by_email").notNull(),
  allowSourceViewing: integer("allow_source_viewing").notNull().default(1),
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
  createdAt: text("created_at").notNull(),
});

// ─── Integration Config ──────────────────────────────────────────────────────

export const integrationConfig = sqliteTable("integration_config", {
  // Single-row table — always key = "main"
  key: text("key").primaryKey().default("main"),
  config: text("config").notNull().default("{}"), // JSON blob
});
