import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Trash2, CheckCircle, XCircle, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Document } from "@edgebric/types";

function StatusBadge({ status }: { status: Document["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        status === "ready" && "bg-green-50 text-green-700",
        status === "processing" && "bg-amber-50 text-amber-700",
        status === "failed" && "bg-red-50 text-red-700",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          status === "ready" && "bg-green-500",
          status === "processing" && "bg-amber-500 animate-pulse",
          status === "failed" && "bg-red-500",
        )}
      />
      {status === "ready" ? "Ready" : status === "processing" ? "Processing" : "Failed"}
    </span>
  );
}

interface UploadingFile {
  name: string;
  docId?: string;
  status: "uploading" | "processing" | "ready" | "failed";
  error?: string;
}

export function DocumentsPanel() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useQuery<Document[]>({
    queryKey: ["documents"],
    queryFn: () =>
      fetch("/api/documents", { credentials: "same-origin" }).then((r) => r.json() as Promise<Document[]>),
    refetchInterval: uploading.some((u) => u.status === "processing") ? 2000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/documents/${docId}`, { method: "DELETE", credentials: "same-origin" }),
    onSuccess: () => {
      setDeleteConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  async function uploadFile(file: File) {
    const entry: UploadingFile = { name: file.name, status: "uploading" };
    setUploading((prev) => [...prev, entry]);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setUploading((prev) =>
          prev.map((u) =>
            u.name === file.name ? { ...u, status: "failed", error: err.error ?? "Upload failed" } : u,
          ),
        );
        return;
      }

      const { documentId } = await res.json() as { documentId: string };
      setUploading((prev) =>
        prev.map((u) => (u.name === file.name ? { ...u, docId: documentId, status: "processing" } : u)),
      );

      const poll = setInterval(() => {
        fetch(`/api/documents/${documentId}`, { credentials: "same-origin" })
          .then((r) => r.json() as Promise<Document>)
          .then((doc) => {
            if (doc.status !== "processing") {
              clearInterval(poll);
              setUploading((prev) =>
                prev.map((u) => (u.docId === documentId ? { ...u, status: doc.status } : u)),
              );
              void queryClient.invalidateQueries({ queryKey: ["documents"] });
              setTimeout(() => {
                setUploading((prev) => prev.filter((u) => u.docId !== documentId));
              }, 3000);
            }
          })
          .catch(() => clearInterval(poll));
      }, 2000);
    } catch {
      setUploading((prev) =>
        prev.map((u) => (u.name === file.name ? { ...u, status: "failed", error: "Upload failed" } : u)),
      );
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      void uploadFile(file);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Documents</h1>
          <p className="text-sm text-slate-500 mt-1">
            Uploaded documents are indexed and available to all employees.
          </p>
        </div>

        {/* Upload zone */}
        <div
          className={cn(
            "border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer",
            dragging ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
          )}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">
            Drop files here or <span className="text-slate-900 underline">browse</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">PDF, DOCX, TXT, MD — max 50MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Upload progress */}
        {uploading.length > 0 && (
          <div className="space-y-2">
            {uploading.map((u, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
              >
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm text-slate-700 flex-1 truncate">{u.name}</span>
                {u.status === "uploading" && (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                )}
                {u.status === "processing" && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Extracting
                  </span>
                )}
                {u.status === "ready" && (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                )}
                {u.status === "failed" && (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {u.error ?? "Failed"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Document list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading documents...
          </div>
        ) : docs.length === 0 && uploading.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No documents uploaded yet.</p>
            <p className="text-xs text-slate-400 mt-1">Drop files above to get started.</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800 truncate block max-w-xs">{doc.name}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="uppercase text-xs font-medium text-slate-500">{doc.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={doc.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {deleteConfirm === doc.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-slate-500">Delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate(doc.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(doc.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-1"
                          title="Delete document"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
