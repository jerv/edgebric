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
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserRole = "owner" | "admin" | "member";
export type UserStatus = "active" | "invited";
export type OidcProviderId = "google" | "microsoft" | "okta" | "onelogin" | "ping" | "generic";

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
  /** OIDC provider that authenticated this user (e.g. "google", "microsoft"). */
  authProvider?: OidcProviderId;
  /** The provider's unique subject ID (sub claim). */
  authProviderSub?: string;
  /** Whether this member can create org-shared data sources. Admins always can. */
  canCreateDataSources?: boolean;
  /** Whether this member can create group chats. Admins always can. */
  canCreateGroupChats?: boolean;
  /** Default notification level for new group chats. */
  defaultGroupChatNotifLevel?: "all" | "mentions" | "none";
  createdAt: Date;
}

// ─── Data Sources ─────────────────────────────────────────────────────────────

export type DataSourceType = "organization" | "personal";
export type DataSourceStatus = "active" | "archived";

export type DataSourceAccessMode = "all" | "restricted";

export interface DataSource {
  id: string;
  name: string;
  description?: string;
  type: DataSourceType;
  /** Admin email (org source) or user email (personal source). */
  ownerId: string;
  /** Resolved display name of the owner (populated by API, not stored). */
  ownerName?: string;
  /** The mKB dataset name for this data source. */
  datasetName: string;
  documentCount: number;
  status: DataSourceStatus;
  accessMode: DataSourceAccessMode;
  /** URL path to the data source avatar image (shown as mini icon in citations). */
  avatarUrl?: string;

  // ─── Per-source security toggles ───────────────────────────────────────────
  /** Can members view raw source document text? (default: true) */
  allowSourceViewing: boolean;
  /** Can this source's chunks be synced to member devices for Vault Mode? (default: true) */
  allowVaultSync: boolean;
  /** Can members access this source from outside the local network? (default: true) */
  allowExternalAccess: boolean;

  /** True when the underlying mKB dataset is being rebuilt (populated by API, not stored). */
  rebuilding?: boolean;

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
  /** FK to data_sources.id — which data source this document belongs to. */
  dataSourceId?: string;
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
  /** Larger parent context for LLM generation (parent-child retrieval). */
  parentContent?: string;
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
  /** Which data source this citation came from (populated by query route). */
  dataSourceName?: string;
  /** Data source ID for avatar lookup (populated by query route). */
  dataSourceId?: string;
  /** Data source avatar URL (populated by query route, shown as mini icon in citations). */
  dataSourceAvatarUrl?: string;
  /** When the source document was last updated (ISO string, for freshness display). */
  documentUpdatedAt?: string;
  /** Chunk ID — used for mesh node attribution lookup. */
  chunkId?: string;
  /** Name of the mesh node this citation came from (null = local node). */
  sourceNodeName?: string;
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
  /** Which datasets were searched (for multi-source transparency). */
  searchedDatasets?: string[];
  /** Populated by the API route layer, not the orchestrator. */
  conversationId?: string;
  /** UUID of the persisted assistant message — populated by the API route layer. */
  messageId?: string;
  /** Average similarity score of context chunks (0-1). Higher = more confident retrieval. */
  retrievalScore?: number;
  /** Number of candidate chunks found before filtering/reranking. */
  candidateCount?: number;
  /** True when BM25 keyword search surfaced results that vector search missed. */
  hybridBoost?: boolean;
}

// ─── Sessions (multi-turn context) ────────────────────────────────────────────

export interface SessionMessage {
  role: "user" | "assistant" | "system";
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

// ─── Notifications ───────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userEmail: string;
  type: "group_chat_invite" | "group_chat_message" | "group_chat_mention" | "source_shared" | "chat_expiring";
  conversationId: string;
  /** For group chat notifications, this is the groupChatId. */
  groupChatId?: string | undefined;
  messageId?: string | undefined;
  title: string;
  body?: string | undefined;
  readAt?: Date | undefined;
  createdAt: Date;
}

export type GroupChatNotifLevel = "all" | "mentions" | "none";

// ─── Org Config ───────────────────────────────────────────────────────────────

export interface IntegrationConfig {
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

// ─── Group Chats ─────────────────────────────────────────────────────────────

export type GroupChatStatus = "active" | "expired" | "archived";
export type GroupChatMemberRole = "creator" | "member";
export type GroupChatExpiration = "24h" | "1w" | "1m" | "never" | "custom";

export interface GroupChat {
  id: string;
  name: string;
  creatorEmail: string;
  orgId: string;
  expiresAt?: Date;
  status: GroupChatStatus;
  members: GroupChatMember[];
  sharedDataSources: GroupChatSharedDataSource[];
  threadCount?: number;
  messageCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupChatMember {
  userEmail: string;
  userName?: string;
  picture?: string;
  role: GroupChatMemberRole;
  joinedAt: Date;
}

export interface GroupChatSharedDataSource {
  id: string;
  dataSourceId: string;
  dataSourceName: string;
  sharedByEmail: string;
  sharedByName?: string;
  allowSourceViewing: boolean;
  /** ISO date when the share expires. Undefined = permanent. */
  expiresAt?: string;
  sharedAt: Date;
}

export interface GroupChatMessage {
  id: string;
  groupChatId: string;
  threadParentId?: string;
  authorEmail?: string;
  authorName?: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  hasConfidentAnswer?: boolean;
  /** Number of replies in thread (populated on main chat messages only). */
  threadReplyCount?: number;
  /** Unique participants in this thread (populated on main chat messages only). */
  threadParticipants?: { email: string; name?: string; picture?: string }[];
  createdAt: Date;
}

// ─── AI Models (re-exported from models.ts) ─────────────────────────────────

export type { ModelStatus, ModelTier, ModelCatalogEntry, InstalledModel, SystemResources, ModelsResponse, PullProgressEvent, RAMFitLevel, RAMFitResult } from "./models.js";
export { OFFICIAL_CATALOG, MODEL_CATALOG_MAP, getRecommendedModelTag, getVisibleCatalog, EMBEDDING_MODEL_TAG, checkModelRAMFit } from "./models.js";

// ─── Mesh Networking (re-exported from mesh.ts) ──────────────────────────────

export type { NodeStatus, NodeRole, MeshNode, NodeGroup, MeshConfig, MeshSearchRequest, MeshSearchResult, MeshSearchResponse, MeshNodeInfo, MeshStatus } from "./mesh.js";

// ─── mimik / Edge Config ──────────────────────────────────────────────────────

export interface EdgeConfig {
  baseUrl: string;
  apiKey: string;
  milmModel: string;
  embeddingModel: string;
}
