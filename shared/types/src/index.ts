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
  /** Show "Verify all important answers" disclaimer below AI responses. Default true. */
  showDisclaimer?: boolean;
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

/** PII detection mode for a data source. */
export type PIIMode = "off" | "warn" | "block";

export interface DataSource {
  id: string;
  name: string;
  description?: string;
  type: DataSourceType;
  /** Admin email (org source) or user email (personal source). */
  ownerId: string;
  /** Resolved display name of the owner (populated by API, not stored). */
  ownerName?: string;
  /** The dataset name prefix for chunk IDs in this data source. */
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
  /** PII detection mode: "off" skips scanning, "warn" scans but continues, "block" halts on PII. */
  piiMode: PIIMode;

  /** True when the dataset is being rebuilt (populated by API, not stored). */
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
  /** Populated after processing; the dataset name for this document's chunks. */
  datasetName?: string;
  /** PII warnings detected during ingestion — admin must approve before proceeding. */
  piiWarnings?: PIIWarning[];
  /** FK to data_sources.id — which data source this document belongs to. */
  dataSourceId?: string;
}

// ─── Chunks ───────────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  sourceDocument: string;
  /** Human-readable filename, populated during ingest and stored in chunk metadata. */
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
  /** Reference to the stored vector after embedding. */
  embeddingId?: string;
}

// ─── Answer Types ────────────────────────────────────────────────────────────

export type AnswerType = "grounded" | "blended" | "general" | "blocked";

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
  /** Number of mesh nodes that were searched (0 when mesh is disabled). */
  meshNodesSearched?: number;
  /** Number of mesh nodes that were unreachable during the search. */
  meshNodesUnavailable?: number;
  /** Classification of the answer source — grounded (docs), blended, general (LLM knowledge), or blocked. */
  answerType?: AnswerType;
  /** Context window usage info for the frontend indicator. */
  contextUsage?: {
    /** Estimated tokens used by the full prompt (system + context + history + query). */
    usedTokens: number;
    /** Maximum context window size for the active model. */
    maxTokens: number;
    /** Breakdown: tokens used by document context. */
    contextTokens: number;
    /** Breakdown: tokens used by conversation history (including summary). */
    historyTokens: number;
    /** Whether conversation history was truncated to fit. */
    truncated: boolean;
  };
  /** Tool uses during this query (only present when model has tool use capability). */
  toolUses?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: { success: boolean; summary: string };
  }>;
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
  answerType?: AnswerType;
  source?: "ai" | "admin" | "system" | undefined;
  toolUses?: Array<{ name: string; arguments: Record<string, unknown>; result: { success: boolean; summary: string } }>;
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
  /** When true, the AI can save and recall user memories. Default: true. */
  memoryEnabled?: boolean;
  /** Documents older than this are flagged as stale. Default: 180 days. */
  stalenessThresholdDays?: number;
  /** When true, the AI answers from general knowledge when no documents match. Default: true. */
  generalAnswersEnabled?: boolean;
  /** Custom Google Drive OAuth credentials (org mode). When set, overrides shipped defaults. */
  googleDriveClientId?: string;
  googleDriveClientSecret?: string;
  /** Custom OneDrive OAuth credentials (org mode). */
  onedriveClientId?: string;
  onedriveClientSecret?: string;
  /** Custom Confluence OAuth credentials (org mode). */
  confluenceClientId?: string;
  confluenceClientSecret?: string;
  /** Custom Notion OAuth credentials (org mode). No shipped defaults — admin must configure. */
  notionClientId?: string;
  notionClientSecret?: string;
  /** When true, decompose complex queries into sub-queries for better results. Default: false. */
  ragDecompose?: boolean;
  /** When true, re-rank search results using LLM relevance scoring. Default: false. */
  ragRerank?: boolean;
  /** When true, perform a second retrieval round if first-round confidence is low. Default: false. */
  ragIterativeRetrieval?: boolean;
  /** Telegram bot integration. */
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  telegramWebhookRegistered?: boolean;
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
  /** Auto-extracted topic label. */
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
  answerType?: AnswerType;
  /** Number of replies in thread (populated on main chat messages only). */
  threadReplyCount?: number;
  /** Unique participants in this thread (populated on main chat messages only). */
  threadParticipants?: { email: string; name?: string; picture?: string }[];
  createdAt: Date;
}

// ─── AI Models (re-exported from models.ts) ─────────────────────────────────

export type { ModelCapabilities, ModelStatus, ModelTier, ModelCatalogEntry, InstalledModel, SystemResources, StorageBreakdown, ModelsResponse, PullProgressEvent, RAMFitLevel, RAMFitResult, SplitGGUFInfo } from "./models.js";
export { OFFICIAL_CATALOG, MODEL_CATALOG_MAP, MODEL_FILENAME_MAP, getRecommendedModelTag, getVisibleCatalog, EMBEDDING_MODEL_TAG, checkModelRAMFit, inferCapabilitiesFromTags, parseSplitGGUF, getAllShardFilenames, getAllShardUrls, allShardsPresent, findCatalogForShard } from "./models.js";

// ─── Mesh Networking (re-exported from mesh.ts) ──────────────────────────────

export type { NodeStatus, NodeRole, MeshNode, NodeGroup, MeshConfig, MeshSearchResult, MeshSearchResponse, MeshNodeInfo, MeshAuthInfo, MeshStatus } from "./mesh.js";

// ─── Cloud Storage Integrations (re-exported from cloud.ts) ──────────────────

export type { CloudProvider, CloudConnectionStatus, CloudFolderSyncStatus, CloudSyncFileStatus, CloudConnection, CloudFolderSync, CloudSyncFile, CloudFolder, CloudProviderInfo } from "./cloud.js";
export { CLOUD_PROVIDERS } from "./cloud.js";

