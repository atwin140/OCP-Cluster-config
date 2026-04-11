/**
 * client/src/lib/auth.ts
 *
 * Auth state management using React context.
 * Token is stored in-memory only (no localStorage — blocked in sandboxed iframes).
 * On page refresh the user will need to log in again — acceptable for a demo.
 *
 * In production with full OpenShift deployment, use HttpOnly cookies with
 * a proper session store (MongoDB-backed) or JWT with refresh tokens.
 */

import { createContext, useContext } from "react";

export type UserRole = "viewer" | "editor" | "admin";

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  displayName?: string | null;
  createdAt: string;
}

export interface AuthState {
  user: CurrentUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isEditor: boolean;
  isAdmin: boolean;
  login: (token: string, user: CurrentUser) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  isAuthenticated: false,
  isEditor: false,
  isAdmin: false,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
