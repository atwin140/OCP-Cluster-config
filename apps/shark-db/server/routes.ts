/**
 * server/routes.ts
 *
 * All Express API routes for the Shark Database application.
 *
 * Auth strategy: session-like token stored in memory map (demo-appropriate).
 * In production this would be JWT or session-store backed by MongoDB.
 *
 * Route summary:
 *   POST /api/auth/login        — authenticate and return session token
 *   POST /api/auth/register     — create new user account
 *   POST /api/auth/logout       — invalidate session token
 *   GET  /api/auth/me           — return current user from token
 *
 *   GET  /api/sharks            — list / search sharks
 *   GET  /api/sharks/:id        — single shark detail
 *   POST /api/sharks            — create shark (editor/admin only)
 *   PUT  /api/sharks/:id        — update shark (editor/admin only)
 *   DELETE /api/sharks/:id      — delete shark (admin only)
 *
 *   GET  /api/sharks/:id/comments   — list comments for a shark
 *   POST /api/sharks/:id/comments   — add a comment (authenticated)
 *
 *   GET  /api/health            — liveness/readiness probe
 */

import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import { storage, initDb, seedDatabase } from "./storage";
import { loginSchema, registerSchema, insertSharkSchema, insertCommentSchema } from "@shared/schema";
import type { User } from "@shared/schema";

// ---------------------------------------------------------------------------
// In-memory session store (demo only — use Redis / MongoDB in production)
// ---------------------------------------------------------------------------

const sessions = new Map<string, { userId: number; expiresAt: number }>();

function generateToken(): string {
  return (
    Math.random().toString(36).substring(2) +
    Math.random().toString(36).substring(2) +
    Date.now().toString(36)
  );
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function getSessionUser(req: Request): User | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  const token = authHeader.slice(7);
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return storage.getUserById(session.userId);
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Authentication required. Please log in." });
  }
  (req as any).currentUser = user;
  next();
}

function requireEditorOrAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).currentUser as User;
  if (!user || (user.role !== "editor" && user.role !== "admin")) {
    return res.status(403).json({ error: "Editor or admin role required." });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).currentUser as User;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin role required." });
  }
  next();
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerRoutes(httpServer: Server, app: Express) {
  // Initialise database tables and seed demo data
  initDb();
  await seedDatabase();

  // ---- Health --------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), service: "shark-db" });
  });

  // ---- Auth ----------------------------------------------------------------

  // POST /api/auth/login
  app.post("/api/auth/login", (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { username, password } = parsed.data;
    const user = storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const valid = bcrypt.compareSync(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const token = generateToken();
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }); // 24h
    const { passwordHash: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  });

  // POST /api/auth/register
  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { username, email, password, displayName } = parsed.data;

    if (storage.getUserByUsername(username)) {
      return res.status(409).json({ error: "Username already taken." });
    }
    if (storage.getUserByEmail(email)) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = storage.createUser({
      username,
      email,
      passwordHash,
      role: "viewer",
      displayName: displayName ?? username,
    });

    const token = generateToken();
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    const { passwordHash: _, ...safeUser } = user;
    res.status(201).json({ token, user: safeUser });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      sessions.delete(authHeader.slice(7));
    }
    res.json({ ok: true });
  });

  // GET /api/auth/me
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = (req as any).currentUser as User;
    const { passwordHash: _, ...safeUser } = user;
    res.json(safeUser);
  });

  // ---- Sharks --------------------------------------------------------------

  // GET /api/sharks  — supports ?search=, ?habitat=, ?status=
  app.get("/api/sharks", (req, res) => {
    const { search, habitat, status } = req.query as Record<string, string>;
    const list = storage.listSharks({ search, habitat, status });
    res.json(list);
  });

  // GET /api/sharks/:id
  app.get("/api/sharks/:id", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid shark ID." });
    const shark = storage.getSharkById(id);
    if (!shark) return res.status(404).json({ error: "Shark not found." });
    res.json(shark);
  });

  // POST /api/sharks  (editor/admin)
  app.post("/api/sharks", requireAuth, requireEditorOrAdmin, (req, res) => {
    const user = (req as any).currentUser as User;
    const parsed = insertSharkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const shark = storage.createShark({ ...parsed.data, createdBy: user.username, updatedBy: user.username });
    res.status(201).json(shark);
  });

  // PUT /api/sharks/:id  (editor/admin)
  app.put("/api/sharks/:id", requireAuth, requireEditorOrAdmin, (req, res) => {
    const user = (req as any).currentUser as User;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid shark ID." });
    const existing = storage.getSharkById(id);
    if (!existing) return res.status(404).json({ error: "Shark not found." });

    // Partial update — only validate provided fields
    const partial = insertSharkSchema.partial().safeParse(req.body);
    if (!partial.success) {
      return res.status(400).json({ error: partial.error.issues[0].message });
    }
    const updated = storage.updateShark(id, partial.data, user.username);
    res.json(updated);
  });

  // DELETE /api/sharks/:id  (admin only)
  app.delete("/api/sharks/:id", requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid shark ID." });
    const ok = storage.deleteShark(id);
    if (!ok) return res.status(404).json({ error: "Shark not found." });
    res.json({ ok: true });
  });

  // ---- Comments ------------------------------------------------------------

  // GET /api/sharks/:id/comments
  app.get("/api/sharks/:id/comments", (req, res) => {
    const sharkId = parseInt(req.params.id);
    if (isNaN(sharkId)) return res.status(400).json({ error: "Invalid shark ID." });
    const list = storage.getCommentsByShark(sharkId);
    res.json(list);
  });

  // POST /api/sharks/:id/comments  (must be authenticated)
  app.post("/api/sharks/:id/comments", requireAuth, (req, res) => {
    const user = (req as any).currentUser as User;
    const sharkId = parseInt(req.params.id);
    if (isNaN(sharkId)) return res.status(400).json({ error: "Invalid shark ID." });

    const shark = storage.getSharkById(sharkId);
    if (!shark) return res.status(404).json({ error: "Shark not found." });

    const bodySchema = insertCommentSchema.pick({ body: true });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    if (!parsed.data.body.trim()) {
      return res.status(400).json({ error: "Comment body cannot be empty." });
    }

    const comment = storage.createComment({
      sharkId,
      userId: user.id,
      username: user.username,
      body: parsed.data.body.trim(),
    });
    res.status(201).json(comment);
  });
}
