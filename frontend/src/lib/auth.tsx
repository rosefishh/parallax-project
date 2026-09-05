import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "snare_officer";

export type Officer = {
  name: string;
  email: string;
};

type AuthContextValue = {
  officer: Officer | null;
  isAuthenticated: boolean;
  signIn: (officer: Officer) => void;
  signUp: (officer: Officer) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): Officer | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === "string" && parsed.name) return parsed;
  } catch {
    /* corrupt or unavailable storage */
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [officer, setOfficer] = useState<Officer | null>(readStored);

  useEffect(() => {
    try {
      if (officer) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(officer));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [officer]);

  return (
    <AuthContext.Provider
      value={{
        officer,
        isAuthenticated: !!officer,
        signIn: setOfficer,
        signUp: setOfficer,
        signOut: () => setOfficer(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
