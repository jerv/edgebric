// ─── Organizations ───────────────────────────────────────────────────────────

export type OrgPlan = "free" | "pro" | "enterprise";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  settings: OrgSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgSettings {
  onboardingComplete?: boolean;
  /** URL path to the org avatar image (e.g. /api/avatars/org-xxx.png). */
  avatarUrl?: string;
  /** Whether bots use org avatar or KB-specific avatars. Default: "org". */
  avatarMode?: "org" | "kb";
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserRole = "owner" | "admin" | "member";
export type UserStatus = "active" | "invited";

export interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  role: UserRole;
  status: UserStatus;
  orgId: string;
  invitedBy?: string;
  lastLoginAt?: Date;
  /** Whether this member can create org-shared knowledge bases. Admins always can. */
  canCreateKBs?: boolean;
  createdAt: Date;
}

// ─── Knowledge Bases ──────────────────────────────────────────────────────────

export type KnowledgeBaseType = "organization" | "personal";
export type KnowledgeBaseStatus = "active" | "archived";

export type KBAccessMode = "all" | "restricted";

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  type: KnowledgeBaseType;
  /** Admin email (org KB) or user email (personal KB). */
  ownerId: string;
  /** Resolved display name of the owner (populated by API, not stored). */
  ownerName?: string;
  /** The mKB dataset name for this knowledge base. */
  datasetName: string;
  documentCount: number;
  status: KnowledgeBaseStatus;
  accessMode: KBAccessMode;
  /** URL path to the KB avatar image (used when org avatarMode is "kb"). */
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Documents ────────────────────────────────────────────────────────────────

export type DocumentType = "pdf" | "docx" | "txt" | "md";
export type DocumentStatus = "processing" | "ready" | "failed" | "pii_review" | "rejected";

export interface Document {
  id: string;
  name: string;
  type: DocumentType;
  /** Only 'policy' documents enter the shared index. */
  classification: "policy";
  uploadedAt: Date;
  updatedAt: Date;
  status: DocumentStatus;
  pageCount?: number;
  sectionHeadings: string[];
  /** Path on disk relative to the data directory. */
  storageKey: string;
  /** Populated after processing; the mKB dataset name for this document. */
  datasetName?: string;
  /** PII warnings detected during ingestion — admin must approve before proceeding. */
  piiWarnings?: PIIWarning[];
  /** FK to knowledge_bases.id — which KB this document belongs to. */
  knowledgeBaseId?: string;
}

// ─── Chunks ───────────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  sourceDocument: string;
  /** Human-readable filename, populated during ingest and stored in mKB chunk metadata. */
  documentName?: string;
  /** Breadcrumb path, e.g. ["Benefits", "Health Insurance", "Deductibles"] */
  sectionPath: string[];
  pageNumber: number;
  heading: string;
  chunkIndex: number;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  metadata: ChunkMetadata;
  /** Reference to the stored vector in mKB after embedding. */
  embeddingId?: string;
}

// ─── Citations & Answers ──────────────────────────────────────────────────────

export interface Citation {
  documentId: string;
  documentName: string;
  sectionPath: string[];
  pageNumber: number;
  /** The relevant passage from the chunk, shown inline. */
  excerpt: string;
  /** Which knowledge base this citation came from (populated by query route). */
  knowledgeBaseName?: string;
  /** KB ID for avatar lookup (populated by query route). */
  knowledgeBaseId?: string;
  /** KB avatar URL (populated by query route when avatarMode is "kb"). */
  knowledgeBaseAvatarUrl?: string;
}

export interface AnswerResponse {
  answer: string;
  citations: Citation[];
  /**
   * false when no relevant chunks were found.
   * UI should show "contact HR" fallback instead of the answer.
   */
  hasConfidentAnswer: boolean;
  sessionId: string;
  /** Which datasets were searched (for multi-KB transparency). */
  searchedDatasets?: string[];
  /** Populated by the API route layer, not the orchestrator. */
  conversationId?: string;
  /** UUID of the persisted assistant message — populated by the API route layer. */
  messageId?: string;
}

// ─── Sessions (multi-turn context) ────────────────────────────────────────────

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export interface Session {
  id: string;
  createdAt: Date;
  messages: SessionMessage[];
}

// ─── Authentication ───────────────────────────────────────────────────────────

/** Anonymous device token issued to employees at first launch. */
export interface DeviceToken {
  id: string;
  issuedAt: Date;
  lastSeenAt: Date;
  isRevoked: boolean;
  /** Admin-assigned human-readable label, e.g. "MacBook - Reception". */
  label?: string;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  userEmail: string;
  userName?: string;
  orgId?: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface PersistedMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  hasConfidentAnswer?: boolean;
  source?: "ai" | "admin" | "system" | undefined;
  createdAt: Date;
}

// ─── Escalation Targets ──────────────────────────────────────────────────────

export interface EscalationTarget {
  id: string;
  name: string;
  role?: string;
  slackUserId?: string;
  email?: string;
  /** Whether this target can receive Slack DM notifications. Defaults to true if slackUserId is set. */
  slackNotify?: boolean;
  /** Whether this target can receive email notifications. Defaults to true if email is set. */
  emailNotify?: boolean;
  createdAt: Date;
}

/** What employees see when picking an escalation target. */
export interface AvailableTarget {
  id: string;
  name: string;
  role?: string;
  methods: ("slack" | "email")[];
}

// ─── Escalations ──────────────────────────────────────────────────────────────

/** "sent" = delivered to integration, "failed" = delivery error, "logged" = no integration configured, "replied" = admin replied, "resolved" = resolved without reply */
export type EscalationStatus = "sent" | "failed" | "logged" | "replied" | "resolved";

export interface Escalation {
  id: string;
  createdAt: Date;
  question: string;
  aiAnswer: string;
  sourceCitations: Citation[];
  status: EscalationStatus;
  notifiedVia?: "slack" | "email";
  conversationId: string;
  messageId: string;
  targetId: string;
  targetName?: string;
  method: "slack" | "email";
  readAt?: Date | null;
  readBy?: string;
  adminReply?: string | undefined;
  repliedAt?: Date | undefined;
  repliedBy?: string | undefined;
  resolvedAt?: Date | undefined;
  resolvedBy?: string | undefined;
  replyMessageId?: string | undefined;
}

export interface EscalateRequest {
  question: string;
  aiAnswer: string;
  citations: Citation[];
  conversationId: string;
  messageId: string;
  targetId: string;
  method: "slack" | "email";
}

export interface EscalateResponse {
  id: string;
  status: EscalationStatus;
  message: string;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userEmail: string;
  type: "admin_reply" | "escalation_resolved";
  conversationId: string;
  escalationId?: string | undefined;
  messageId?: string | undefined;
  title: string;
  body?: string | undefined;
  readAt?: Date | undefined;
  createdAt: Date;
}

// ─── Integrations ─────────────────────────────────────────────────────────────

export interface SlackIntegration {
  botToken: string;
  enabled: boolean;
}

export interface EmailIntegration {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  useTls: boolean;
  enabled: boolean;
}

export interface IntegrationConfig {
  slack?: SlackIntegration;
  email?: EmailIntegration;
  privateModeEnabled?: boolean;
  vaultModeEnabled?: boolean;
  /** Documents older than this are flagged as stale. Default: 180 days. */
  stalenessThresholdDays?: number;
}

// ─── PII Detection ────────────────────────────────────────────────────────────

export interface PIIWarning {
  chunkIndex: number;
  /** The flagged passage (truncated for display). */
  excerpt: string;
  /** Human-readable description of what was detected. */
  pattern: string;
}

// ─── Query Filter ─────────────────────────────────────────────────────────────

export type FilterReason = "person_name_sensitive_term";

export interface FilterResult {
  allowed: boolean;
  reason?: FilterReason;
  redirectMessage?: string;
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export interface Feedback {
  id: string;
  conversationId: string;
  messageId: string;
  rating: "up" | "down";
  /** All messages (user + assistant) up to and including the rated message. */
  messageSnapshot: Array<{ role: string; content: string }>;
  /** Auto-extracted topic label for analytics grouping. */
  topic?: string | undefined;
  /** Optional note from user explaining a thumbs-down rating. */
  comment?: string | undefined;
  createdAt: Date;
}

export interface FeedbackCheck {
  rated: boolean;
  rating?: "up" | "down" | undefined;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  overview: {
    totalConversations: number;
    totalMessages: number;
    uniqueUsers: number;
  };
  feedback: {
    up: number;
    down: number;
    total: number;
  };
  escalations: {
    total: number;
    sent: number;
    failed: number;
    unread: number;
  };
  /** Percentage of thumbs-up out of total feedback, or null if no feedback yet. */
  satisfactionRate: number | null;
}

export interface QueryVolumeEntry {
  date: string;
  count: number;
}

export interface TopicCluster {
  topic: string;
  count: number;
  /** Fraction of "up" ratings for this topic (0-1). */
  upRate: number;
}

export interface UnansweredQuestion {
  question: string;
  aiAnswer: string;
  createdAt: string;
  conversationId: string;
  messageId: string;
  feedback?: { rating: "up" | "down"; comment?: string | undefined } | undefined;
  resolvedAt?: string | undefined;
}

// ─── mimik / Edge Config ──────────────────────────────────────────────────────

export interface EdgeConfig {
  baseUrl: string;
  apiKey: string;
  milmModel: string;
  embeddingModel: string;
}
