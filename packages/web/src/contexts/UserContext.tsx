import { createContext, useContext } from "react";

export interface User {
  isAdmin: boolean;
  queryToken: string;
  email?: string;
  name?: string;
  picture?: string;
  orgId?: string;
  orgName?: string;
  orgSlug?: string;
  privateModeEnabled?: boolean;
  vaultModeEnabled?: boolean;
  canCreateKBs?: boolean;
  onboardingComplete?: boolean;
  needsNameSetup?: boolean;
  orgAvatarUrl?: string;
  avatarMode?: "org" | "kb";
}

export const UserContext = createContext<User | null | undefined>(undefined);

export function useUser(): User | null {
  const ctx = useContext(UserContext);
  if (ctx === undefined) throw new Error("useUser must be used within UserContext.Provider");
  return ctx;
}
