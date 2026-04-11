/**
 * shared/schema.ts
 *
 * Single source of truth for all database tables, Zod insert schemas, and TypeScript types.
 *
 * NOTE FOR DEMO CONTEXT:
 *   This application uses SQLite (via better-sqlite3 + Drizzle ORM) for the interactive
 *   web demo. In the full production deployment on OpenShift the data is split:
 *     - PostgreSQL  → shark records (structured data, audit trail)
 *     - MongoDB     → users, sessions, comments (auth / user-generated content)
 *   The schema here mirrors that logical split — users + comments in one "collection"
 *   mindset and sharks in a "relational table" mindset — even though both live in
 *   SQLite locally. Seed data and audit fields are identical to the production model.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// USERS  (maps to MongoDB in production)
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // "viewer" can read & comment; "editor" can also create/edit shark records
  role: text("role", { enum: ["viewer", "editor", "admin"] })
    .notNull()
    .default("viewer"),
  displayName: text("display_name"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Schema used for login — just username + password
export const loginSchema = z.object({
  username: z.string().min(2, "Username must be at least 2 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Schema for registration
export const registerSchema = z
  .object({
    username: z
      .string()
      .min(2)
      .max(30)
      .regex(/^[a-z0-9_-]+$/i, "Letters, numbers, _ and - only"),
    email: z.string().email(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
    displayName: z.string().min(1).max(60).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

// ---------------------------------------------------------------------------
// SHARKS  (maps to PostgreSQL in production)
// ---------------------------------------------------------------------------

export const sharks = sqliteTable("sharks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  commonName: text("common_name").notNull(),
  scientificName: text("scientific_name").notNull(),
  habitat: text("habitat").notNull(),
  // Serialised JSON array of diet items e.g. '["fish","squid"]'
  diet: text("diet").notNull().default("[]"),
  // Max length in metres
  maxLengthM: real("max_length_m"),
  // Max weight in kg
  maxWeightKg: real("max_weight_kg"),
  conservationStatus: text("conservation_status", {
    enum: [
      "Least Concern",
      "Near Threatened",
      "Vulnerable",
      "Endangered",
      "Critically Endangered",
      "Data Deficient",
      "Not Evaluated",
    ],
  })
    .notNull()
    .default("Not Evaluated"),
  // Serialised JSON array of fun fact strings
  funFacts: text("fun_facts").notNull().default("[]"),
  imageUrl: text("image_url"),
  // Audit fields — critical for GitOps / change-management demo
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedBy: text("updated_by").notNull().default("system"),
  createdBy: text("created_by").notNull().default("system"),
});

export const insertSharkSchema = createInsertSchema(sharks)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Accept arrays from the API and serialise in storage layer
    diet: z.array(z.string()).or(z.string()),
    funFacts: z.array(z.string()).or(z.string()),
    maxLengthM: z.number().positive().optional().nullable(),
    maxWeightKg: z.number().positive().optional().nullable(),
  });
export type InsertShark = z.infer<typeof insertSharkSchema>;
export type Shark = typeof sharks.$inferSelect;

// ---------------------------------------------------------------------------
// COMMENTS  (maps to MongoDB in production — user-generated content)
// ---------------------------------------------------------------------------

export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sharkId: integer("shark_id").notNull(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(), // denormalised for display speed
  body: text("body").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const insertCommentSchema = createInsertSchema(comments).omit({
  id: true,
  createdAt: true,
});
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof comments.$inferSelect;
