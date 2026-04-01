/**
 * Network tab — mesh networking configuration and node dashboard.
 * Admin-only. Shows mesh config, registered nodes, node groups, and controls.
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Network, Server, Plus, Trash2, Pencil, Copy, Check, Eye, EyeOff,
  RefreshCw, Power, PowerOff, ChevronDown, ChevronRight, AlertTriangle,
  Loader2, Shield, Globe, HelpCircle, Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MeshConfig {
  enabled: boolean;
  configured: boolean;
  role?: "primary" | "secondary";
  nodeId?: string;
  nodeName?: string;
  meshToken?: string;
  primaryEndpoint?: string | null;
  groupId?: string | null;
  orgId?: string;
}

interface MeshNode {
  id: string;
  name: string;
  role: "primary" | "secondary";
  status: "online" | "offline" | "connecting";
  endpoint: string;
  groupId: string | null;
  sourceCount: number;
  lastSeen: string;
  version: string;
}

interface NodeGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  nodeCount: number;
}

interface MeshStatus {
  enabled: boolean;
  role: string | null;
  nodeId: string | null;
  nodeName: string | null;
  connectedNodes: number;
  totalNodes: number;
  primaryReachable: boolean | null;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/** Wrapper that adds credentials: "same-origin" to all requests. */
function api(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { credentials: "same-origin", ...init });
}

async function fetchMeshConfig(): Promise<MeshConfig> {
  const res = await api("/api/mesh/config");
  if (!res.ok) throw new Error(`Failed to fetch mesh config (${res.status})`);
  return res.json();
}

async function fetchMeshStatus(): Promise<MeshStatus> {
  const res = await api("/api/mesh/status");
  if (!res.ok) throw new Error(`Failed to fetch mesh status (${res.status})`);
  return res.json();
}

async function fetchNodes(): Promise<MeshNode[]> {
  const res = await api("/api/mesh/nodes");
  if (!res.ok) throw new Error(`Failed to fetch nodes (${res.status})`);
  return res.json();
}

async function fetchGroups(): Promise<NodeGroup[]> {
  const res = await api("/api/mesh/groups");
  if (!res.ok) throw new Error(`Failed to fetch groups (${res.status})`);
  return res.json();
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        status === "online" && "bg-emerald-500",
        status === "offline" && "bg-slate-300 dark:bg-gray-600",
        status === "connecting" && "bg-amber-500 animate-pulse",
      )}
    />
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full",
        role === "primary"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : "bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-400",
      )}
    >
      {role === "primary" ? <Shield className="w-3 h-3" /> : <Server className="w-3 h-3" />}
      {role === "primary" ? "Primary" : "Secondary"}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={copy}
      className="p-1 text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Mesh Setup Form ─────────────────────────────────────────────────────────

function MeshSetupForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<"primary" | "secondary">("primary");
  const [nodeName, setNodeName] = useState("");
  const [primaryEndpoint, setPrimaryEndpoint] = useState("");

  const initMutation = useMutation({
    mutationFn: async () => {
      const res = await api("/api/mesh/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          nodeName: nodeName.trim(),
          ...(role === "secondary" && { primaryEndpoint: primaryEndpoint.trim() }),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to initialize mesh");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mesh-config"] });
      void queryClient.invalidateQueries({ queryKey: ["mesh-status"] });
      onDone();
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-2">Node Role</label>
          <div className="flex gap-3">
            {(["primary", "secondary"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "flex-1 p-4 rounded-xl border-2 text-left transition-all",
                  role === r
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                    : "border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {r === "primary" ? <Shield className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                  <span className="font-medium text-sm text-slate-900 dark:text-gray-100">
                    {r === "primary" ? "Primary Node" : "Secondary Node"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  {r === "primary"
                    ? "Handles authentication for all nodes. Set up first."
                    : "Connects to an existing primary node for authentication."}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Node Name</label>
          <input
            type="text"
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            placeholder='e.g., "HR Office — 3rd Floor"'
            className="w-full px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {role === "secondary" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Primary Node Endpoint</label>
            <input
              type="url"
              value={primaryEndpoint}
              onChange={(e) => setPrimaryEndpoint(e.target.value)}
              placeholder="https://primary-node.local:3001"
              className="w-full px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={() => onDone()}
          className="px-4 py-2 text-sm text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200"
        >
          Cancel
        </button>
        <button
          onClick={() => initMutation.mutate()}
          disabled={!nodeName.trim() || (role === "secondary" && !primaryEndpoint.trim()) || initMutation.isPending}
          className="px-4 py-2 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          {initMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Initialize Mesh"}
        </button>
      </div>

      {initMutation.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">{initMutation.error.message}</p>
      )}
    </div>
  );
}

// ─── Node Card ───────────────────────────────────────────────────────────────

function NodeCard({ node, onRemove }: { node: MeshNode; onRemove: (id: string) => void }) {
  const ago = timeSince(node.lastSeen);

  return (
    <div className="flex items-center justify-between py-3 px-4 border border-slate-200 dark:border-gray-800 rounded-xl">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot status={node.status} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{node.name}</span>
            <RoleBadge role={node.role} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-gray-500 mt-0.5">
            <span>{node.endpoint}</span>
            <span>{node.sourceCount} source{node.sourceCount !== 1 ? "s" : ""}</span>
            <span>Last seen {ago}</span>
          </div>
        </div>
      </div>
      <button
        onClick={() => onRemove(node.id)}
        className="p-1.5 text-slate-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
        title="Remove from mesh"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Node Group Section ──────────────────────────────────────────────────────

function GroupSection({
  group,
  nodes,
  onRemoveNode,
  onDeleteGroup,
}: {
  group: NodeGroup | null;
  nodes: MeshNode[];
  onRemoveNode: (id: string) => void;
  onDeleteGroup?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const label = group ? group.name : "Ungrouped";
  const count = nodes.length;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <div className="flex items-center gap-2">
          {group && (
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: group.color }}
            />
          )}
          <span className="text-sm font-medium text-slate-700 dark:text-gray-300">{label}</span>
          <span className="text-xs text-slate-400 dark:text-gray-500">({count})</span>
        </div>
        {group && onDeleteGroup && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }}
            className="ml-auto p-1 text-slate-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400"
            title="Delete group"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </button>
      {expanded && (
        <div className="space-y-2 pl-6">
          {nodes.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-gray-500 py-2">No nodes in this group</p>
          ) : (
            nodes.map((n) => <NodeCard key={n.id} node={n} onRemove={onRemoveNode} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create Group Dialog ─────────────────────────────────────────────────────

function CreateGroupForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3b82f6");

  const PRESET_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api("/api/mesh/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), color }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mesh-groups"] });
      onDone();
    },
  });

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-medium text-slate-900 dark:text-gray-100">New Node Group</h4>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder='e.g., "Legal", "HR", "Engineering"'
        className="w-full px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-gray-400">Color:</span>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={cn(
              "w-6 h-6 rounded-full border-2 transition-all",
              color === c ? "border-slate-900 dark:border-gray-100 scale-110" : "border-transparent",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1.5 text-xs text-slate-500 dark:text-gray-400">Cancel</button>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || createMutation.isPending}
          className="px-3 py-1.5 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}

// ─── Register Node Form ──────────────────────────────────────────────────────

function RegisterNodeForm({ groups, onDone }: { groups: NodeGroup[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [role, setRole] = useState<"primary" | "secondary">("secondary");
  const [groupId, setGroupId] = useState("");

  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await api("/api/mesh/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: name.trim(),
          role,
          endpoint: endpoint.trim(),
          ...(groupId && { groupId }),
        }),
      });
      if (!res.ok) throw new Error("Failed to register node");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mesh-nodes"] });
      onDone();
    },
  });

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-medium text-slate-900 dark:text-gray-100">Register Node</h4>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Node name"
        className="w-full px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="url"
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        placeholder="https://node-address:3001"
        className="w-full px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex gap-3">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "primary" | "secondary")}
          className="px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm"
        >
          <option value="secondary">Secondary</option>
          <option value="primary">Primary</option>
        </select>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="flex-1 px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 text-sm"
        >
          <option value="">Ungrouped</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1.5 text-xs text-slate-500 dark:text-gray-400">Cancel</button>
        <button
          onClick={() => registerMutation.mutate()}
          disabled={!name.trim() || !endpoint.trim() || registerMutation.isPending}
          className="px-3 py-1.5 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg disabled:opacity-50"
        >
          Register
        </button>
      </div>
    </div>
  );
}

// ─── Mesh Explainer ─────────────────────────────────────────────────────────

function MeshExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        <HelpCircle className="w-4 h-4 flex-shrink-0" />
        <span className="font-medium">What is mesh networking?</span>
        <ChevronDown className={cn("w-4 h-4 ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-slate-600 dark:text-gray-400 space-y-4 border-t border-slate-100 dark:border-gray-800 pt-3">
          {/* Diagram */}
          <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 font-mono text-xs text-slate-500 dark:text-gray-500 leading-relaxed">
            <pre className="whitespace-pre overflow-x-auto">{`
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ HR Node  │    │  Legal   │    │   Eng    │
  │(Primary) │◄──►│  Node    │◄──►│  Node    │
  │          │    │          │    │          │
  │ Handbook │    │ Contracts│    │ Runbooks │
  │ Benefits │    │ IP Docs  │    │ API Docs │
  └──────────┘    └──────────┘    └──────────┘
        ▲               ▲               ▲
        └───────── query fans out ───────┘
                        │
                   ┌─────────┐
                   │ Employee │
                   │  asks a  │
                   │ question │
                   └─────────┘`.trim()}</pre>
          </div>
          <div className="space-y-2">
            <p><strong className="text-slate-700 dark:text-gray-300">Data never moves.</strong> Each node keeps its own documents. Nothing is copied or synced between nodes.</p>
            <p><strong className="text-slate-700 dark:text-gray-300">Queries move.</strong> When an employee asks a question, the query fans out to every node. Each node searches its local sources and sends back results.</p>
            <p><strong className="text-slate-700 dark:text-gray-300">Resilient.</strong> If a node goes offline, the rest keep working. Results from unavailable nodes are simply skipped.</p>
            <p><strong className="text-slate-700 dark:text-gray-300">One login.</strong> The primary node handles authentication. Other nodes proxy login through it — no duplicate setup needed.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main NetworkTab ─────────────────────────────────────────────────────────

export function NetworkTab() {
  const queryClient = useQueryClient();
  const [showSetup, setShowSetup] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showRegisterNode, setShowRegisterNode] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [fullToken, setFullToken] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRegenToken, setConfirmRegenToken] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [discoveredNodes, setDiscoveredNodes] = useState<Array<{ name: string; host: string; port: number; endpoint: string }>>([]);
  const [isScanning, setIsScanning] = useState(false);

  const { data: meshConfig, isLoading: configLoading } = useQuery({
    queryKey: ["mesh-config"],
    queryFn: fetchMeshConfig,
    refetchInterval: 30_000,
  });

  const { data: status } = useQuery({
    queryKey: ["mesh-status"],
    queryFn: fetchMeshStatus,
    refetchInterval: 10_000,
    enabled: !!meshConfig?.configured,
  });

  const { data: nodes = [] } = useQuery({
    queryKey: ["mesh-nodes"],
    queryFn: fetchNodes,
    refetchInterval: 15_000,
    enabled: !!meshConfig?.configured,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["mesh-groups"],
    queryFn: fetchGroups,
    enabled: !!meshConfig?.configured,
  });

  const toggleMeshMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await api("/api/mesh/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle mesh");
    },
    onSuccess: () => {
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: ["mesh-config"] });
      void queryClient.invalidateQueries({ queryKey: ["mesh-status"] });
    },
    onError: (err: Error) => setMutationError(err.message),
  });

  const leaveMeshMutation = useMutation({
    mutationFn: async () => {
      await api("/api/mesh/config", { method: "DELETE" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mesh-config"] });
      void queryClient.invalidateQueries({ queryKey: ["mesh-status"] });
      setConfirmLeave(false);
    },
  });

  const removeNodeMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      const res = await api(`/api/mesh/nodes/${nodeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove node");
    },
    onSuccess: () => {
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: ["mesh-nodes"] });
      void queryClient.invalidateQueries({ queryKey: ["mesh-status"] });
    },
    onError: (err: Error) => setMutationError(err.message),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const res = await api(`/api/mesh/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete group");
    },
    onSuccess: () => {
      setMutationError(null);
      void queryClient.invalidateQueries({ queryKey: ["mesh-groups"] });
      void queryClient.invalidateQueries({ queryKey: ["mesh-nodes"] });
    },
    onError: (err: Error) => setMutationError(err.message),
  });

  const regenTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await api("/api/mesh/config/regenerate-token", { method: "POST" });
      return res.json() as Promise<{ meshToken: string }>;
    },
    onSuccess: (data) => {
      setFullToken(data.meshToken);
      setShowToken(true);
      setConfirmRegenToken(false);
      void queryClient.invalidateQueries({ queryKey: ["mesh-config"] });
    },
  });

  const fetchFullToken = useCallback(async () => {
    const res = await api("/api/mesh/config/token");
    const data = await res.json() as { meshToken: string };
    setFullToken(data.meshToken);
    setShowToken(true);
  }, []);

  const scanLan = useCallback(async () => {
    setIsScanning(true);
    setDiscoveredNodes([]);
    try {
      const res = await api("/api/mesh/discover");
      if (!res.ok) {
        if (res.status === 501) {
          setMutationError("LAN discovery not available in this deployment");
        } else {
          setMutationError("Failed to scan LAN");
        }
        return;
      }
      const data = await res.json() as { instances: Array<{ name: string; host: string; port: number; endpoint: string }> };
      // Filter out nodes already registered
      const registeredEndpoints = new Set(nodes.map((n) => n.endpoint));
      const newInstances = data.instances.filter((i) => !registeredEndpoints.has(i.endpoint));
      setDiscoveredNodes(newInstances);
    } catch {
      setMutationError("LAN scan failed");
    } finally {
      setIsScanning(false);
    }
  }, [nodes]);

  const addDiscoveredNode = useCallback(async (instance: { name: string; endpoint: string }) => {
    try {
      const res = await api("/api/mesh/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: instance.name,
          role: "secondary" as const,
          endpoint: instance.endpoint,
        }),
      });
      if (!res.ok) throw new Error("Failed to register node");
      void queryClient.invalidateQueries({ queryKey: ["mesh-nodes"] });
      void queryClient.invalidateQueries({ queryKey: ["mesh-status"] });
      // Remove from discovered list
      setDiscoveredNodes((prev) => prev.filter((n) => n.endpoint !== instance.endpoint));
    } catch {
      setMutationError("Failed to add discovered node");
    }
  }, [queryClient]);

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // ── Not configured — show setup ──────────────────────────────────────────
  if (!meshConfig?.configured) {
    if (showSetup) {
      return (
        <div className="space-y-6">
          <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-6">
            <MeshSetupForm onDone={() => setShowSetup(false)} />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center mx-auto">
            <Network className="w-6 h-6 text-blue-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-gray-100">Mesh Networking</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400 max-w-lg mx-auto">
            Connect multiple Edgebric nodes so queries can search across all of them.
            Each node keeps its own data — documents never leave their node. If a node goes offline,
            the rest keep working.
          </p>
          <button
            onClick={() => setShowSetup(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors"
          >
            <Network className="w-4 h-4" />
            Set Up Mesh
          </button>
        </div>
        <MeshExplainer />
      </div>
    );
  }

  // ── Configured — show dashboard ──────────────────────────────────────────

  // Group nodes by groupId
  const nodesByGroup = new Map<string | null, MeshNode[]>();
  for (const node of nodes) {
    const key = node.groupId;
    if (!nodesByGroup.has(key)) nodesByGroup.set(key, []);
    nodesByGroup.get(key)!.push(node);
  }

  const onlineCount = status?.connectedNodes ?? 0;
  const totalCount = status?.totalNodes ?? 0;

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className={cn(
        "border rounded-2xl p-5",
        meshConfig.enabled
          ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-900/10"
          : "border-slate-200 dark:border-gray-800",
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center",
              meshConfig.enabled
                ? "bg-emerald-100 dark:bg-emerald-800/30"
                : "bg-slate-100 dark:bg-gray-800",
            )}>
              {meshConfig.enabled
                ? <Power className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                : <PowerOff className="w-5 h-5 text-slate-400 dark:text-gray-500" />}
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100">
                {meshConfig.enabled ? "Mesh Active" : "Mesh Disabled"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                {!meshConfig.enabled
                  ? "Query routing to other nodes is paused"
                  : totalCount === 0
                    ? "No other nodes connected"
                    : `${onlineCount} of ${totalCount} nodes online`}
              </p>
              {meshConfig.enabled && meshConfig.role === "secondary" && (
                status?.primaryReachable === null ? (
                  <p className="text-xs flex items-center gap-1 text-slate-400 dark:text-gray-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Checking primary...
                  </p>
                ) : (
                  <p className={cn(
                    "text-xs flex items-center gap-1",
                    status?.primaryReachable
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-500 dark:text-red-400",
                  )}>
                    <span className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full",
                      status?.primaryReachable ? "bg-emerald-500" : "bg-red-500 animate-pulse",
                    )} />
                    {status?.primaryReachable ? "Primary reachable" : "Primary unreachable"}
                  </p>
                )
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => toggleMeshMutation.mutate(!meshConfig.enabled)}
              disabled={toggleMeshMutation.isPending}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                meshConfig.enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-gray-600",
              )}
            >
              <span className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                meshConfig.enabled ? "translate-x-6" : "translate-x-1",
              )} />
            </button>
          </div>
        </div>
      </div>

      {/* Mutation error banner */}
      {mutationError && (
        <div className="flex items-center justify-between border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2">
          <p className="text-sm text-red-600 dark:text-red-400">{mutationError}</p>
          <button onClick={() => setMutationError(null)} className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* This Node */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100 flex items-center gap-2">
          <Server className="w-4 h-4 text-slate-400" />
          This Node
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-400 dark:text-gray-500">Name</span>
            <p className="text-slate-900 dark:text-gray-100 font-medium">{meshConfig.nodeName}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-gray-500">Role</span>
            <div className="mt-0.5"><RoleBadge role={meshConfig.role ?? "primary"} /></div>
          </div>
          <div>
            <span className="text-slate-400 dark:text-gray-500">Node ID</span>
            <p className="text-slate-900 dark:text-gray-100 font-mono text-xs">{meshConfig.nodeId}</p>
          </div>
          <div>
            <span className="text-slate-400 dark:text-gray-500">Mesh Token</span>
            <div className="flex items-center gap-1">
              <p className="text-slate-900 dark:text-gray-100 font-mono text-xs">
                {showToken && fullToken ? fullToken : meshConfig.meshToken}
              </p>
              {showToken && fullToken ? (
                <CopyButton text={fullToken} />
              ) : (
                <button
                  onClick={fetchFullToken}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-gray-300"
                  title="Show full token"
                >
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Node Groups + Nodes */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100 flex items-center gap-2">
            <Globe className="w-4 h-4 text-slate-400" />
            Nodes ({totalCount})
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={scanLan}
              disabled={isScanning}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 border border-slate-200 dark:border-gray-700 rounded-lg"
            >
              {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
              {isScanning ? "Scanning..." : "Scan LAN"}
            </button>
            <button
              onClick={() => setShowCreateGroup(!showCreateGroup)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 border border-slate-200 dark:border-gray-700 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Group
            </button>
            <button
              onClick={() => setShowRegisterNode(!showRegisterNode)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Node
            </button>
          </div>
        </div>

        {showCreateGroup && (
          <CreateGroupForm onDone={() => setShowCreateGroup(false)} />
        )}

        {showRegisterNode && (
          <RegisterNodeForm groups={groups} onDone={() => setShowRegisterNode(false)} />
        )}

        {/* Discovered nodes (mDNS scan results) */}
        {discoveredNodes.length > 0 && (
          <div className="border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
              <Radar className="w-3.5 h-3.5" />
              Discovered on LAN ({discoveredNodes.length})
            </h4>
            <div className="space-y-2">
              {discoveredNodes.map((inst) => (
                <div key={inst.endpoint} className="flex items-center justify-between py-2 px-3 border border-blue-100 dark:border-blue-800/50 rounded-lg bg-white dark:bg-gray-900">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-900 dark:text-gray-100">{inst.name}</span>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{inst.endpoint}</p>
                  </div>
                  <button
                    onClick={() => addDiscoveredNode(inst)}
                    className="px-2.5 py-1 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grouped nodes */}
        <div className="space-y-4">
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              nodes={nodesByGroup.get(group.id) ?? []}
              onRemoveNode={(id) => removeNodeMutation.mutate(id)}
              onDeleteGroup={(id) => deleteGroupMutation.mutate(id)}
            />
          ))}
          {/* Ungrouped */}
          {(nodesByGroup.get(null)?.length ?? 0) > 0 && (
            <GroupSection
              group={null}
              nodes={nodesByGroup.get(null) ?? []}
              onRemoveNode={(id) => removeNodeMutation.mutate(id)}
            />
          )}
          {nodes.length === 0 && !showRegisterNode && (
            <p className="text-sm text-slate-400 dark:text-gray-500 text-center py-6">
              No other nodes registered. Add nodes to start using mesh networking.
            </p>
          )}
        </div>
      </div>

      {/* Mesh Settings */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100 flex items-center gap-2">
          <Pencil className="w-4 h-4 text-slate-400" />
          Mesh Settings
        </h3>

        {/* Regenerate token */}
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm text-slate-700 dark:text-gray-300">Regenerate Mesh Token</p>
            <p className="text-xs text-slate-400 dark:text-gray-500">All secondary nodes will need the new token to reconnect.</p>
          </div>
          {confirmRegenToken ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => regenTokenMutation.mutate()}
                disabled={regenTokenMutation.isPending}
                className="px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg"
              >
                Confirm
              </button>
              <button onClick={() => setConfirmRegenToken(false)} className="px-3 py-1.5 text-xs text-slate-500">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRegenToken(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
          )}
        </div>

        {/* Leave mesh */}
        <div className="flex items-center justify-between py-2 border-t border-slate-100 dark:border-gray-800">
          <div>
            <p className="text-sm text-red-600 dark:text-red-400">Leave Mesh</p>
            <p className="text-xs text-slate-400 dark:text-gray-500">Permanently removes this node from the mesh. Node registrations will be deleted.</p>
          </div>
          {confirmLeave ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => leaveMeshMutation.mutate()}
                disabled={leaveMeshMutation.isPending}
                className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg"
              >
                {leaveMeshMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Confirm Leave"}
              </button>
              <button onClick={() => setConfirmLeave(false)} className="px-3 py-1.5 text-xs text-slate-500">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmLeave(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Leave Mesh
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function timeSince(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
