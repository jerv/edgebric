import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle, Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarUpload } from "@/components/shared/AvatarUpload";

const STEPS = [
  { label: "Organization" },
  { label: "Data Source" },
  { label: "Upload Document" },
] as const;

interface ExistingKB {
  id: string;
  name: string;
  description?: string;
}

export function OnboardingWizard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1: Organization name
  const [orgName, setOrgName] = useState("My Company");

  // Step 1 avatar
  const [orgAvatarUrl, setOrgAvatarUrl] = useState<string | undefined>(undefined);

  // Step 2: KB
  const [kbName, setKbName] = useState("Policy Documents");
  const [kbDescription, setKbDescription] = useState("Company-wide policies and procedures");
  const [kbId, setKbId] = useState<string | null>(null);
  const [existingKB, setExistingKB] = useState<ExistingKB | null>(null);

  // Check for existing KBs on mount (ensureDefaultKB may have created one at startup)
  useEffect(() => {
    void fetch("/api/knowledge-bases", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((kbs: ExistingKB[]) => {
        if (kbs.length > 0) {
          const first = kbs[0]!;
          setExistingKB(first);
          setKbName(first.name);
          if (first.description) setKbDescription(first.description);
        }
      })
      .catch(() => {});
  }, []);

  // Step 3: Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState("");

  const saveOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/org", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: orgName.trim() }),
      });
      if (!res.ok) throw new Error("Failed to save organization");
    },
    onSuccess: () => setStep(1),
  });

  const createKBMutation = useMutation({
    mutationFn: async () => {
      // If a KB already exists (from ensureDefaultKB), update it instead of creating a duplicate
      if (existingKB) {
        const res = await fetch(`/api/knowledge-bases/${existingKB.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ name: kbName.trim(), description: kbDescription.trim() }),
        });
        if (!res.ok) {
          const err = await res.json() as { error?: string };
          throw new Error(err.error ?? "Failed to update data source");
        }
        return { id: existingKB.id };
      }

      const res = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: kbName.trim(), description: kbDescription.trim() }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to create data source");
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (data) => {
      setKbId(data.id);
      setStep(2);
    },
  });

  async function handleUpload(file: File) {
    if (!kbId) return;
    setUploadStatus("uploading");
    setUploadError("");

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/knowledge-bases/${kbId}/documents/upload`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setUploadError(err.error ?? "Upload failed");
        setUploadStatus("error");
        return;
      }
      setUploadStatus("done");
    } catch {
      setUploadError("Upload failed");
      setUploadStatus("error");
    }
  }

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/org/complete-onboarding", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to complete onboarding");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void navigate({ to: "/" });
    },
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-800 w-full max-w-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Welcome to Edgebric</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Let's set up your knowledge assistant</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium",
                  i < step && "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
                  i === step && "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900",
                  i > step && "bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500",
                )}
              >
                {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("w-8 h-px", i < step ? "bg-green-300 dark:bg-green-700" : "bg-slate-200 dark:bg-gray-700")} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Organization */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <AvatarUpload
                avatarUrl={orgAvatarUrl}
                onUpload={async (file) => {
                  const form = new FormData();
                  form.append("avatar", file);
                  const res = await fetch("/api/admin/org/avatar", {
                    method: "POST",
                    credentials: "same-origin",
                    body: form,
                  });
                  if (!res.ok) throw new Error("Upload failed");
                  const data = await res.json() as { avatarUrl: string };
                  setOrgAvatarUrl(data.avatarUrl);
                  return data.avatarUrl;
                }}
                onRemove={async () => {
                  await fetch("/api/admin/org/avatar", { method: "DELETE", credentials: "same-origin" });
                  setOrgAvatarUrl(undefined);
                }}
                size={80}
                fallbackText={orgName.slice(0, 2) || "CO"}
              />
              <p className="text-xs text-slate-400 dark:text-gray-500">Organization logo (optional)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Organization Name</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-gray-400"
                placeholder="Your company name"
              />
            </div>
            <button
              onClick={() => saveOrgMutation.mutate()}
              disabled={!orgName.trim() || saveOrgMutation.isPending}
              className="w-full bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg py-2 text-sm font-medium hover:bg-slate-700 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {saveOrgMutation.isPending ? "Saving..." : "Continue"}
            </button>
          </div>
        )}

        {/* Step 2: Source */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Data Source Name</label>
              <input
                type="text"
                value={kbName}
                onChange={(e) => setKbName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-gray-400"
                placeholder="e.g., Policy Documents"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Description (optional)</label>
              <input
                type="text"
                value={kbDescription}
                onChange={(e) => setKbDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-gray-400"
                placeholder="What documents will this contain?"
              />
            </div>
            {createKBMutation.error && (
              <p className="text-sm text-red-600 dark:text-red-400">{createKBMutation.error.message}</p>
            )}
            <button
              onClick={() => createKBMutation.mutate()}
              disabled={!kbName.trim() || createKBMutation.isPending}
              className="w-full bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg py-2 text-sm font-medium hover:bg-slate-700 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {createKBMutation.isPending ? "Creating..." : "Create Data Source"}
            </button>
          </div>
        )}

        {/* Step 3: Upload */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-gray-400">
              Upload your first document to start building your data source. Supported formats: PDF, DOCX, TXT, MD.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />

            {uploadStatus === "idle" && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-300 dark:border-gray-600 rounded-lg py-8 flex flex-col items-center gap-2 hover:border-slate-400 dark:hover:border-gray-500 transition-colors"
              >
                <Upload className="w-6 h-6 text-slate-400 dark:text-gray-500" />
                <span className="text-sm text-slate-500 dark:text-gray-400">Click to select a file</span>
              </button>
            )}

            {uploadStatus === "uploading" && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </div>
            )}

            {uploadStatus === "done" && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="w-4 h-4" />
                Document uploaded successfully! It will be processed in the background.
              </div>
            )}

            {uploadStatus === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>
                <button
                  onClick={() => { setUploadStatus("idle"); fileInputRef.current?.click(); }}
                  className="text-sm text-slate-600 dark:text-gray-400 underline"
                >
                  Try again
                </button>
              </div>
            )}

            <div className="flex gap-2">
              {uploadStatus !== "done" && (
                <button
                  onClick={() => completeOnboarding.mutate()}
                  className="flex-1 border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-400 rounded-lg py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
                >
                  Skip for now
                </button>
              )}
              {uploadStatus === "done" && (
                <button
                  onClick={() => completeOnboarding.mutate()}
                  disabled={completeOnboarding.isPending}
                  className="flex-1 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg py-2 text-sm font-medium hover:bg-slate-700 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {completeOnboarding.isPending ? "Finishing..." : "Get Started"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
