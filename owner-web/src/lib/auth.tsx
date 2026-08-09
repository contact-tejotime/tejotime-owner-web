"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, UserRole } from "@/lib/roles";
import { MOCK_BUSINESS, MOCK_USER } from "@/lib/mock-data";

const STORAGE_KEY = "tejotime_owner_web_session";

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  login: (phone: string, password: string) => { ok: true } | { ok: false; error: string };
  logout: () => void;
  setRole: (role: UserRole) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function writeStored(session: Session | null) {
  if (typeof window === "undefined") return;
  if (!session) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readStored());
    setReady(true);
  }, []);

  const login = useCallback((phone: string, password: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      return { ok: false as const, error: "Enter a valid phone number." };
    }
    if (!password || password.length < 4) {
      return { ok: false as const, error: "Enter your password." };
    }
    // UI-only: any valid-looking credentials create a mock owner session.
    const next: Session = {
      user: { ...MOCK_USER, phone: digits, role: "owner" },
      business: { id: MOCK_BUSINESS.id, name: MOCK_BUSINESS.name, slug: MOCK_BUSINESS.slug },
    };
    writeStored(next);
    setSession(next);
    return { ok: true as const };
  }, []);

  const logout = useCallback(() => {
    writeStored(null);
    setSession(null);
  }, []);

  const setRole = useCallback((role: UserRole) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user: { ...prev.user, role } };
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ session, ready, login, logout, setRole }),
    [session, ready, login, logout, setRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
