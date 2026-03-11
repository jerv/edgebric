import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useUser } from "./UserContext";

export type PrivacyLevel = "standard" | "private" | "vault";

/** Minimal message shape stored across navigation. */
export interface PrivacyMessage {
  role: "user" | "assistant";
  content: string;
  citations?: unknown[];
  hasConfidentAnswer?: boolean;
}

interface PrivacyState {
  level: PrivacyLevel;
  setLevel: (level: PrivacyLevel) => void;
  privateModeAvailable: boolean;
  vaultModeAvailable: boolean;
  vaultSetupComplete: boolean;
  setVaultSetupComplete: (complete: boolean) => void;
  /** Messages stored across navigation for privacy modes. */
  privacyMessages: PrivacyMessage[];
  setPrivacyMessages: (msgs: PrivacyMessage[]) => void;
}

const PrivacyContext = createContext<PrivacyState | undefined>(undefined);

const VAULT_SETUP_KEY = "edgebric-vault-setup-complete";

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const [level, setLevelState] = useState<PrivacyLevel>("standard");
  const [vaultSetupComplete, setVaultSetupCompleteState] = useState(() => {
    try {
      return localStorage.getItem(VAULT_SETUP_KEY) === "true";
    } catch {
      return false;
    }
  });
  // Using ref + state pair: ref for stable setter, state for reactivity.
  const privacyMessagesRef = useRef<PrivacyMessage[]>([]);
  const [privacyMessages, setPrivacyMessagesState] = useState<PrivacyMessage[]>([]);

  const setPrivacyMessages = useCallback((msgs: PrivacyMessage[]) => {
    privacyMessagesRef.current = msgs;
    setPrivacyMessagesState(msgs);
  }, []);

  const privateModeAvailable = user?.privateModeEnabled ?? false;
  const vaultModeAvailable =
    (user?.vaultModeEnabled ?? false) && vaultSetupComplete;

  const setLevel = useCallback(
    (newLevel: PrivacyLevel) => {
      if (newLevel === "private" && !privateModeAvailable) return;
      if (newLevel === "vault" && !vaultModeAvailable) return;
      // Clear messages when switching modes
      if (newLevel !== level) {
        setPrivacyMessages([]);
      }
      setLevelState(newLevel);
    },
    [privateModeAvailable, vaultModeAvailable, level, setPrivacyMessages],
  );

  const setVaultSetupComplete = useCallback((complete: boolean) => {
    setVaultSetupCompleteState(complete);
    try {
      if (complete) {
        localStorage.setItem(VAULT_SETUP_KEY, "true");
      } else {
        localStorage.removeItem(VAULT_SETUP_KEY);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  return (
    <PrivacyContext.Provider
      value={{
        level,
        setLevel,
        privateModeAvailable,
        vaultModeAvailable,
        vaultSetupComplete,
        setVaultSetupComplete,
        privacyMessages,
        setPrivacyMessages,
      }}
    >
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyState {
  const ctx = useContext(PrivacyContext);
  if (!ctx)
    throw new Error("usePrivacy must be used within PrivacyProvider");
  return ctx;
}
