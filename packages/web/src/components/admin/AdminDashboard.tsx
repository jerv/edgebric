import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Document } from "@edgebric/types";
import { cn } from "@/lib/utils";

type Tab = "documents" | "analytics" | "escalations" | "devices";

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("documents");

  const tabs: { id: Tab; label: string }[] = [
    { id: "documents", label: "Documents" },
    { id: "analytics", label: "Analytics" },
    { id: "escalations", label: "Escalations" },
    { id: "devices", label: "Devices" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-slate-900">Edgebric Admin</span>
        <button
          onClick={() => {
            localStorage.removeItem("edgebric_admin_token");
            window.location.href = "/admin";
          }}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Sign out
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "documents" && <DocumentsPanel />}
        {activeTab === "analytics" && <AnalyticsPanel />}
        {activeTab === "escalations" && <EscalationsPanel />}
        {activeTab === "devices" && <DevicesPanel />}
      </div>
    </div>
  );
}

function DocumentsPanel() {
  const token = localStorage.getItem("edgebric_admin_token") ?? "";
  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ["documents"],
    queryFn: async () => {
      const res = await fetch("/api/documents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json() as Promise<Document[]>;
    },
  });

  if (isLoading) return <div className="text-slate-400 text-sm">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-slate-900 font-medium">Policy Documents</h2>
        <UploadButton />
      </div>

      {!documents || documents.length === 0 ? (
        <div className="bg-white border border-slate-200 border-dashed rounded-2xl p-12 text-center">
          <p className="text-slate-400 text-sm">No documents uploaded yet.</p>
          <p className="text-slate-400 text-sm mt-1">Upload a PDF, Word doc, or Markdown file to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-slate-500 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-900 font-medium">{doc.name}</td>
                  <td className="px-4 py-3 text-slate-500 uppercase text-xs">{doc.type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(doc.uploadedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Document["status"] }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium",
      status === "ready" && "bg-green-50 text-green-700",
      status === "processing" && "bg-amber-50 text-amber-700",
      status === "failed" && "bg-red-50 text-red-700",
    )}>
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        status === "ready" && "bg-green-500",
        status === "processing" && "bg-amber-500 animate-pulse",
        status === "failed" && "bg-red-500",
      )} />
      {status}
    </span>
  );
}

function UploadButton() {
  const [uploading, setUploading] = useState(false);
  const token = localStorage.getItem("edgebric_admin_token") ?? "";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      await fetch("/api/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      window.location.reload();
    } finally {
      setUploading(false);
    }
  }

  return (
    <label className={cn(
      "cursor-pointer bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors",
      uploading && "opacity-50 cursor-wait",
    )}>
      {uploading ? "Uploading..." : "Upload Document"}
      <input type="file" className="hidden" accept=".pdf,.docx,.txt,.md" onChange={(e) => void handleFileChange(e)} />
    </label>
  );
}

function AnalyticsPanel() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
      <p className="text-slate-400 text-sm">Analytics will populate after employees start using Edgebric.</p>
      <p className="text-slate-400 text-sm mt-1">Topics only appear after 5 distinct queries.</p>
    </div>
  );
}

function EscalationsPanel() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
      <p className="text-slate-400 text-sm">No escalations yet.</p>
      <p className="text-slate-400 text-sm mt-1">Escalations appear when employees click "Ask HR to verify."</p>
    </div>
  );
}

function DevicesPanel() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
      <p className="text-slate-400 text-sm">Device token management coming soon.</p>
    </div>
  );
}
