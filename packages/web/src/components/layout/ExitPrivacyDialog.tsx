import type { PrivacyLevel } from "@/contexts/PrivacyContext";

interface Props {
  currentLevel: Exclude<PrivacyLevel, "standard">;
  onConfirm: () => void;
  onClose: () => void;
}

const LABELS: Record<Exclude<PrivacyLevel, "standard">, { title: string; description: string }> = {
  private: {
    title: "Exit Private Mode?",
    description: "All messages in this session will be permanently lost. Private conversations are never saved.",
  },
  vault: {
    title: "Exit Vault Mode?",
    description: "All messages in this session will be permanently lost. Vault conversations are never saved. Your synced data will remain on your device.",
  },
};

export function ExitPrivacyDialog({ currentLevel, onConfirm, onClose }: Props) {
  const { title, description } = LABELS[currentLevel];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed mb-5">
          {description}
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={onConfirm}
            className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors"
          >
            Exit
          </button>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
