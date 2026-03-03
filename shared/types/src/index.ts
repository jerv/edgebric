// ─── Documents ────────────────────────────────────────────────────────────────

export type DocumentType = "pdf" | "docx" | "txt" | "md";
export type DocumentStatus = "processing" | "ready" | "failed";

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
}

// ─── Chunks ───────────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  sourceDocument: string;
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

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

// ─── Citations & Answers ──────────────────────────────────────────────────────

export interface Citation {
  documentId: string;
  documentName: string;
  sectionPath: string[];
  pageNumber: number;
  /** The relevant passage from the chunk, shown inline. */
  excerpt: string;
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

// ─── Escalations ──────────────────────────────────────────────────────────────

export type EscalationStatus = "open" | "answered" | "closed";

export interface Escalation {
  id: string;
  createdAt: Date;
  question: string;
  aiAnswer: string;
  sourceCitations: Citation[];
  status: EscalationStatus;
  hrResponse?: string;
  hrRespondedAt?: Date;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface TopicCluster {
  id: string;
  label: string;
  /** Raw count. UI suppresses display if < 5. */
  queryCount: number;
  period: {
    start: Date;
    end: Date;
  };
}

export interface AnalyticsSummary {
  periodStart: Date;
  periodEnd: Date;
  totalQueries: number;
  /** Only clusters with queryCount >= 5 are included. */
  topicClusters: TopicCluster[];
  unansweredCount: number;
  escalationCount: number;
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

// ─── mimik / Edge Config ──────────────────────────────────────────────────────

export interface EdgeConfig {
  baseUrl: string;
  apiKey: string;
  milmModel: string;
  embeddingModel: string;
}
