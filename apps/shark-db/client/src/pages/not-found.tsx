import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen shark-gradient flex items-center justify-center">
      <div className="text-center">
        <div className="text-7xl mb-4">🦈</div>
        <h1 className="text-2xl font-bold mb-2">404 — Shark Not Found</h1>
        <p className="text-muted-foreground mb-6">
          This page has been swallowed by the deep.
        </p>
        <Link href="/">
          <a className="text-primary hover:underline">← Return to surface</a>
        </Link>
      </div>
    </div>
  );
}
