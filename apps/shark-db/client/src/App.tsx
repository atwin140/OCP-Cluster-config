/**
 * App.tsx — root component.
 *
 * Sets up:
 *   - AuthContext provider (in-memory token + user)
 *   - TanStack Query client
 *   - Hash-based routing (required for iframe/S3 deployment)
 *   - All page routes
 */

import { useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthContext } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import type { CurrentUser } from "@/lib/auth";

// Pages
import LoginPage from "@/pages/LoginPage";
import SearchPage from "@/pages/SearchPage";
import SharkDetailPage from "@/pages/SharkDetailPage";
import EditSharkPage from "@/pages/EditSharkPage";
import AllSharksPage from "@/pages/AllSharksPage";
import NotFound from "@/pages/not-found";

// ---------------------------------------------------------------------------
// Auth provider
// ---------------------------------------------------------------------------

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  function login(newToken: string, newUser: CurrentUser) {
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  const isAuthenticated = !!user;
  const isEditor = user?.role === "editor" || user?.role === "admin";
  const isAdmin = user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{ user, token, isAuthenticated, isEditor, isAdmin, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Protected route wrapper
// ---------------------------------------------------------------------------

function ProtectedRoute({
  component: Component,
  ...props
}: {
  component: React.ComponentType<any>;
  [key: string]: any;
}) {
  // We rely on Navbar's logout to clear state;
  // unauthenticated state is visible on the login page.
  // For the demo, all routes are accessible — the server enforces role checks.
  return <Component {...props} />;
}

// ---------------------------------------------------------------------------
// Root app
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router hook={useHashLocation}>
          {/* Force dark mode globally (ocean theme) */}
          <div className="dark">
            <Switch>
              {/* Public */}
              <Route path="/" component={LoginPage} />

              {/* Authenticated */}
              <Route path="/search" component={SearchPage} />
              <Route path="/sharks" component={AllSharksPage} />
              <Route path="/sharks/new" component={EditSharkPage} />
              <Route path="/sharks/:id/edit" component={EditSharkPage} />
              <Route path="/sharks/:id" component={SharkDetailPage} />

              {/* 404 */}
              <Route component={NotFound} />
            </Switch>
          </div>
        </Router>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
