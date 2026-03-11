import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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

// ─── Escalation Targets ─────────────────────────────────────────────────────

export const escalationTargets = sqliteTable("escalation_targets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role"),
  slackUserId: text("slack_user_id"),
  email: text("email"),
  createdAt: text("created_at").notNull(),
});

// ─── Escalations ─────────────────────────────────────────────────────────────

export const escalations = sqliteTable("escalations", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  question: text("question").notNull(),
  aiAnswer: text("ai_answer").notNull(),
  sourceCitations: text("source_citations").notNull().default("[]"),
  status: text("status").notNull(),
  notifiedVia: text("notified_via"),
  conversationId: text("conversation_id"),
  messageId: text("message_id"),
  targetId: text("target_id"),
  targetName: text("target_name"),
  method: text("method"),
  readAt: text("read_at"),
  readBy: text("read_by"),
  adminReply: text("admin_reply"),
  repliedAt: text("replied_at"),
  repliedBy: text("replied_by"),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
  replyMessageId: text("reply_message_id"),
});

// ─── Notifications ──────────────────────────────────────────────────────────

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  type: text("type").notNull(), // "admin_reply" | "escalation_resolved"
  conversationId: text("conversation_id").notNull(),
  escalationId: text("escalation_id"),
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
  createdAt: text("created_at").notNull(),
});

// ─── Question Resolutions ───────────────────────────────────────────────────

export const questionResolutions = sqliteTable("question_resolutions", {
  messageId: text("message_id").primaryKey(), // assistant message id
  resolvedAt: text("resolved_at").notNull(),
  resolvedBy: text("resolved_by"),
});

// ─── Integration Config ──────────────────────────────────────────────────────

export const integrationConfig = sqliteTable("integration_config", {
  // Single-row table — always key = "main"
  key: text("key").primaryKey().default("main"),
  config: text("config").notNull().default("{}"), // JSON blob
});
