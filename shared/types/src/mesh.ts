// ─── Mesh Networking ─────────────────────────────────────────────────────────

export type NodeStatus = "online" | "offline" | "connecting";
export type NodeRole = "primary" | "secondary";

export interface MeshNode {
  id: string;
  /** Human-readable label (e.g., "HR Office - 3rd Floor") */
  name: string;
  role: NodeRole;
  status: NodeStatus;
  /** Reachable endpoint (e.g., "https://hr-node.local:3001") */
  endpoint: string;
  groupId: string | null;
  groupName: string | null;
  /** Number of sources hosted on this node */
  sourceCount: number;
  /** ISO timestamp of last heartbeat */
  lastSeen: string;
  /** Edgebric version for compatibility checks */
  version: string;
  orgId: string;
}

export interface NodeGroup {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  /** Hex color for UI badges (e.g., "#3b82f6") */
  color: string;
  orgId: string;
}

export interface MeshConfig {
  enabled: boolean;
  role: NodeRole;
  /** Null if this IS the primary node */
  primaryEndpoint: string | null;
  /** Shared secret for node-to-node auth */
  meshToken: string;
  nodeId: string;
  nodeName: string;
  groupId: string | null;
  orgId: string;
}

export interface MeshSearchResult {
  chunkId: string;
  content: string;
  similarity: number;
  documentName?: string;
  sectionPath?: string[];
  pageNumber?: number;
  heading?: string;
  /** Name of the source this chunk belongs to */
  sourceName: string;
}

export interface MeshSearchResponse {
  chunks: MeshSearchResult[];
  nodeId: string;
  nodeName: string;
}

export interface MeshNodeInfo {
  nodeId: string;
  nodeName: string;
  role: NodeRole;
  version: string;
  sourceCount: number;
  groupId: string | null;
  groupName: string | null;
}

/** Response from GET /api/mesh/peer/auth-info */
export interface MeshAuthInfo {
  provider: string;
  providerName: string;
}

/** Status returned by GET /api/mesh/status */
export interface MeshStatus {
  enabled: boolean;
  role: NodeRole | null;
  nodeId: string | null;
  nodeName: string | null;
  connectedNodes: number;
  totalNodes: number;
  primaryEndpoint: string | null;
  primaryReachable: boolean | null;
}
