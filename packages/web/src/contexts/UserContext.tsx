import { createContext, useContext } from "react";

export interface User {
  isAdmin: boolean;
  queryToken: string;
  email?: string;
  name?: string;
  picture?: string;
  privateModeEnabled?: boolean;
  vaultModeEnabled?: boolean;
}

export const UserContext = createContext<User | null | undefined>(undefined);

export function useUser(): User | null {
  const ctx = useContext(UserContext);
  if (ctx === undefined) throw new Error("useUser must be used within UserContext.Provider");
  return ctx;
}
