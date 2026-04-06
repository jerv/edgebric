import { useState, useRef } from "react";
import { Camera, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AvatarUploadProps {
  /** Current avatar URL, or undefined for no avatar. */
  avatarUrl?: string;
  /** Called when a new file is selected. Should upload and return the new URL. */
  onUpload: (file: File) => Promise<string>;
  /** Called to remove the avatar. */
  onRemove?: () => Promise<void>;
  /** Size in px. Default 64. */
  size?: number;
  /** Max file size in MB. Default 5. */
  maxSizeMB?: number;
  /** Fallback text (e.g. org initials). */
  fallbackText?: string;
  /** Whether the avatar is editable. Default true. */
  editable?: boolean;
  /** Additional className for the container. */
  className?: string;
}

export function AvatarUpload({
  avatarUrl,
  onUpload,
  onRemove,
  size = 64,
  maxSizeMB = 5,
  fallbackText = "?",
  editable = true,
  className,
}: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayUrl = previewUrl ?? avatarUrl;

  async function handleFile(file: File) {
    setError(null);

    // Client-side size check
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File too large (max ${maxSizeMB}MB)`);
      return;
    }

    // Client-side type check
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      setError("Unsupported format. Use PNG, JPG, WebP, or GIF.");
      return;
    }

    setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    try {
      await onUpload(file);
      setPreviewUrl(undefined); // Will use the server URL now
    } catch {
      setPreviewUrl(undefined);
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleRemove() {
    if (!onRemove) return;
    setError(null);
    setUploading(true);
    try {
      await onRemove();
      setPreviewUrl(undefined);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      <div className="relative inline-block group">
        <div
          className={cn(
            "rounded-full overflow-hidden bg-blue-50 dark:bg-blue-950 flex items-center justify-center flex-shrink-0 border border-blue-200 dark:border-blue-800",
            editable && "cursor-pointer",
          )}
          style={{ width: size, height: size }}
          onClick={() => { if (editable) { inputRef.current?.click(); } setError(null); }}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="Avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <span
              className="text-blue-500 dark:text-blue-400 font-semibold select-none"
              style={{ fontSize: size * 0.35 }}
            >
              {fallbackText.slice(0, 2).toUpperCase()}
            </span>
          )}

          {/* Overlay on hover */}
          {editable && !uploading && (
            <div className="absolute inset-0 rounded-full bg-black/40 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="text-white" style={{ width: size * 0.3, height: size * 0.3 }} />
            </div>
          )}

          {/* Loading spinner */}
          {uploading && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <Loader2 className="text-white animate-spin" style={{ width: size * 0.3, height: size * 0.3 }} />
            </div>
          )}
        </div>

        {/* Remove button */}
        {editable && displayUrl && onRemove && !uploading && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleRemove(); }}
            className="absolute -top-1 -right-1 w-5 h-5 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-700 rounded-full flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-50 dark:hover:bg-red-950 hover:border-red-200 dark:hover:border-red-800"
            title="Remove avatar"
          >
            <X className="w-3 h-3 text-slate-400 dark:text-gray-500 hover:text-red-500" />
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <p className="text-[11px] text-red-500 text-center max-w-[120px] leading-tight">{error}</p>
      )}

      {/* Hint */}
      {editable && !error && !displayUrl && (
        <p className="text-[10px] text-slate-400 dark:text-gray-500 text-center">Max {maxSizeMB}MB</p>
      )}
    </div>
  );
}

/** Read-only avatar display — no upload capability. */
export function Avatar({
  avatarUrl,
  size = 32,
  fallbackText = "?",
  className,
}: {
  avatarUrl?: string;
  size?: number;
  fallbackText?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-full overflow-hidden bg-blue-50 dark:bg-blue-950 flex items-center justify-center flex-shrink-0 border border-blue-200 dark:border-blue-800",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
      ) : (
        <span
          className="text-blue-500 dark:text-blue-400 font-semibold select-none"
          style={{ fontSize: size * 0.35 }}
        >
          {fallbackText.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}
