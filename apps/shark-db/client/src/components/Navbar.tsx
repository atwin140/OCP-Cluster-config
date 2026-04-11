/**
 * Navbar — top navigation bar for all authenticated pages.
 * Shows logo, nav links, and the current user's name + logout button.
 */

import { Link, useLocation } from "wouter";
import { LogOut, Search, Database, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SharkLogo } from "./SharkLogo";
import { useAuth } from "@/lib/auth";
import { apiRequest, setAuthToken, queryClient } from "@/lib/queryClient";

export function Navbar() {
  const { user, logout, isEditor, isAdmin } = useAuth();
  const [location] = useLocation();

  async function handleLogout() {
    await apiRequest("POST", "/api/auth/logout");
    setAuthToken(null);
    queryClient.clear();
    logout();
  }

  const navLinks = [
    { href: "/search", label: "Search Sharks", icon: Search },
    { href: "/sharks", label: "All Sharks", icon: Database },
  ];

  return (
    <nav
      className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md"
      data-testid="navbar"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/">
            <a data-testid="nav-logo">
              <SharkLogo size={28} />
            </a>
          </Link>

          {/* Nav links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <a
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    location.startsWith(href)
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  data-testid={`nav-link-${label.toLowerCase().replace(/\s/g, "-")}`}
                >
                  <Icon size={14} />
                  {label}
                </a>
              </Link>
            ))}
          </div>

          {/* User section */}
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2">
                <User size={14} className="text-muted-foreground" />
                <span
                  className="text-sm text-muted-foreground hidden sm:block"
                  data-testid="navbar-username"
                >
                  {user.displayName ?? user.username}
                </span>
                {(isAdmin || isEditor) && (
                  <Badge
                    variant="outline"
                    className="border-primary/50 text-primary text-xs py-0"
                    data-testid="navbar-role-badge"
                  >
                    {isAdmin ? "admin" : "editor"}
                  </Badge>
                )}
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleLogout}
              data-testid="btn-logout"
            >
              <LogOut size={14} className="mr-1" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
