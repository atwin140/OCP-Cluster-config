/**
 * server/storage.ts
 *
 * Storage layer — all database interactions go through this interface.
 * Routes stay thin; business logic lives here.
 *
 * Uses Drizzle ORM with better-sqlite3 (synchronous driver).
 * In production: swap this layer for separate PostgreSQL (sharks) + MongoDB (users/comments).
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, like, or, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  users,
  sharks,
  comments,
  type User,
  type InsertUser,
  type Shark,
  type InsertShark,
  type Comment,
  type InsertComment,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// DB initialisation
// ---------------------------------------------------------------------------

const sqlite = new Database("shark_db.sqlite");
// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// ---------------------------------------------------------------------------
// Schema creation (runs on startup)
// ---------------------------------------------------------------------------

export function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      username       TEXT    NOT NULL UNIQUE,
      email          TEXT    NOT NULL UNIQUE,
      password_hash  TEXT    NOT NULL,
      role           TEXT    NOT NULL DEFAULT 'viewer',
      display_name   TEXT,
      created_at     TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sharks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      common_name         TEXT    NOT NULL,
      scientific_name     TEXT    NOT NULL,
      habitat             TEXT    NOT NULL,
      diet                TEXT    NOT NULL DEFAULT '[]',
      max_length_m        REAL,
      max_weight_kg       REAL,
      conservation_status TEXT    NOT NULL DEFAULT 'Not Evaluated',
      fun_facts           TEXT    NOT NULL DEFAULT '[]',
      image_url           TEXT,
      created_at          TEXT    NOT NULL,
      updated_at          TEXT    NOT NULL,
      updated_by          TEXT    NOT NULL DEFAULT 'system',
      created_by          TEXT    NOT NULL DEFAULT 'system'
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      shark_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      username   TEXT    NOT NULL,
      body       TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Helper — serialise/deserialise JSON array columns
// ---------------------------------------------------------------------------

function serialiseArray(val: string[] | string | undefined | null): string {
  if (!val) return "[]";
  if (typeof val === "string") {
    // Already JSON? Try parsing, if it fails treat as single-item array
    try {
      JSON.parse(val);
      return val;
    } catch {
      return JSON.stringify([val]);
    }
  }
  return JSON.stringify(val);
}

function parsedShark(raw: Shark): Shark & { dietArr: string[]; funFactsArr: string[] } {
  return {
    ...raw,
    dietArr: (() => { try { return JSON.parse(raw.diet); } catch { return []; } })(),
    funFactsArr: (() => { try { return JSON.parse(raw.funFacts); } catch { return []; } })(),
  };
}

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------

export interface IStorage {
  // Users
  getUserById(id: number): User | undefined;
  getUserByUsername(username: string): User | undefined;
  getUserByEmail(email: string): User | undefined;
  createUser(data: InsertUser): User;
  listUsers(): User[];

  // Sharks
  getSharkById(id: number): (Shark & { dietArr: string[]; funFactsArr: string[] }) | undefined;
  listSharks(opts?: { search?: string; habitat?: string; status?: string }): (Shark & { dietArr: string[]; funFactsArr: string[] })[];
  createShark(data: InsertShark): Shark;
  updateShark(id: number, data: Partial<InsertShark>, updatedBy: string): Shark | undefined;
  deleteShark(id: number): boolean;

  // Comments
  getCommentsByShark(sharkId: number): Comment[];
  createComment(data: InsertComment): Comment;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

export class SqliteStorage implements IStorage {
  // ---- Users ---------------------------------------------------------------

  getUserById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  getUserByUsername(username: string): User | undefined {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  getUserByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email)).get();
  }

  createUser(data: InsertUser): User {
    return db.insert(users).values(data).returning().get();
  }

  listUsers(): User[] {
    return db.select().from(users).all();
  }

  // ---- Sharks --------------------------------------------------------------

  getSharkById(id: number) {
    const raw = db.select().from(sharks).where(eq(sharks.id, id)).get();
    return raw ? parsedShark(raw) : undefined;
  }

  listSharks(opts: { search?: string; habitat?: string; status?: string } = {}) {
    // Build conditions manually for SQLite LIKE search
    let query = db.select().from(sharks);
    const raw = query.all();
    // Filter in JS since SQLite LIKE with multiple OR columns is verbose
    let result = raw;
    if (opts.search) {
      const q = opts.search.toLowerCase();
      result = result.filter(
        (s) =>
          s.commonName.toLowerCase().includes(q) ||
          s.scientificName.toLowerCase().includes(q)
      );
    }
    if (opts.habitat) {
      result = result.filter((s) =>
        s.habitat.toLowerCase().includes(opts.habitat!.toLowerCase())
      );
    }
    if (opts.status) {
      result = result.filter((s) => s.conservationStatus === opts.status);
    }
    return result.map(parsedShark);
  }

  createShark(data: InsertShark): Shark {
    const now = new Date().toISOString();
    return db
      .insert(sharks)
      .values({
        ...data,
        diet: serialiseArray(data.diet as string[] | string),
        funFacts: serialiseArray(data.funFacts as string[] | string),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  updateShark(id: number, data: Partial<InsertShark>, updatedBy: string): Shark | undefined {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { ...data, updatedAt: now, updatedBy };
    if (data.diet !== undefined) patch.diet = serialiseArray(data.diet as string[] | string);
    if (data.funFacts !== undefined)
      patch.funFacts = serialiseArray(data.funFacts as string[] | string);

    const result = db
      .update(sharks)
      .set(patch)
      .where(eq(sharks.id, id))
      .returning()
      .get();
    return result;
  }

  deleteShark(id: number): boolean {
    const res = db.delete(sharks).where(eq(sharks.id, id)).run();
    return res.changes > 0;
  }

  // ---- Comments ------------------------------------------------------------

  getCommentsByShark(sharkId: number): Comment[] {
    return db
      .select()
      .from(comments)
      .where(eq(comments.sharkId, sharkId))
      .all();
  }

  createComment(data: InsertComment): Comment {
    return db.insert(comments).values(data).returning().get();
  }
}

// Singleton
export const storage = new SqliteStorage();

// ---------------------------------------------------------------------------
// Seed data — runs once if tables are empty
// ---------------------------------------------------------------------------

export async function seedDatabase() {
  // Only seed if no users exist
  const existingUsers = db.select().from(users).all();
  if (existingUsers.length > 0) return;

  console.log("🦈 Seeding demo data...");

  // --- Demo users ---
  const demoUsers: Array<{ username: string; email: string; password: string; role: "viewer" | "editor" | "admin"; displayName: string }> = [
    {
      username: "admin",
      email: "admin@sharkdb.demo",
      password: "SharkAdmin123!",
      role: "admin",
      displayName: "Admin Sharkley",
    },
    {
      username: "editor",
      email: "editor@sharkdb.demo",
      password: "SharkEdit123!",
      role: "editor",
      displayName: "Finn Editorson",
    },
    {
      username: "viewer",
      email: "viewer@sharkdb.demo",
      password: "SharkView123!",
      role: "viewer",
      displayName: "Sandy Viewer",
    },
  ];

  for (const u of demoUsers) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    db.insert(users)
      .values({
        username: u.username,
        email: u.email,
        passwordHash,
        role: u.role,
        displayName: u.displayName,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  // --- Demo sharks ---
  const sharkData: Array<Omit<InsertShark, "updatedBy" | "createdBy"> & { updatedBy: string; createdBy: string }> = [
    {
      commonName: "Great White Shark",
      scientificName: "Carcharodon carcharias",
      habitat: "Coastal and offshore temperate and tropical waters",
      diet: ["marine mammals", "fish", "rays", "seabirds"],
      maxLengthM: 6.1,
      maxWeightKg: 2268,
      conservationStatus: "Vulnerable",
      funFacts: [
        "Great whites can detect a single drop of blood in 100 litres of water.",
        "They can breach completely out of the water when hunting seals.",
        "Great whites have no natural predators except orcas (sometimes).",
        "Their eyes are the same size as a human's.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/White_shark.jpg/640px-White_shark.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Hammerhead Shark",
      scientificName: "Sphyrna mokarran",
      habitat: "Warm temperate and tropical coastal waters",
      diet: ["stingrays", "fish", "octopus", "squid", "crustaceans"],
      maxLengthM: 6.0,
      maxWeightKg: 580,
      conservationStatus: "Critically Endangered",
      funFacts: [
        "The wide-set eyes give a nearly 360-degree field of vision.",
        "Hammerheads are often seen in large schools during the day.",
        "Their heads help them pin stingrays to the seafloor while feeding.",
        "They use electroreception to find prey buried in the sand.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Hammerhead.jpg/640px-Hammerhead.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Whale Shark",
      scientificName: "Rhincodon typus",
      habitat: "Open ocean, tropical and warm temperate seas",
      diet: ["plankton", "krill", "fish eggs", "small fish", "squid"],
      maxLengthM: 18.8,
      maxWeightKg: 21500,
      conservationStatus: "Endangered",
      funFacts: [
        "Whale sharks are the largest fish in the ocean.",
        "Despite their size they feed only on tiny plankton.",
        "They have unique spot patterns like a fingerprint.",
        "They can live up to 150 years.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Whale_shark_Georgia_aquarium.jpg/640px-Whale_shark_Georgia_aquarium.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Bull Shark",
      scientificName: "Carcharhinus leucas",
      habitat: "Coastal shallow water, estuaries, rivers",
      diet: ["bony fish", "dolphins", "turtles", "birds", "sharks"],
      maxLengthM: 3.4,
      maxWeightKg: 316,
      conservationStatus: "Vulnerable",
      funFacts: [
        "Bull sharks can survive in fresh water — they've been found in the Amazon and Mississippi Rivers.",
        "They have one of the highest testosterone levels of any animal.",
        "Bull sharks are responsible for more unprovoked attacks near shore than any other species.",
        "They give birth to live pups.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/BullShark.jpg/640px-BullShark.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Tiger Shark",
      scientificName: "Galeocerdo cuvier",
      habitat: "Coastal and offshore tropical and subtropical waters",
      diet: ["sea turtles", "dolphins", "birds", "fish", "crustaceans", "garbage"],
      maxLengthM: 5.5,
      maxWeightKg: 635,
      conservationStatus: "Near Threatened",
      funFacts: [
        "Tiger sharks are known as 'garbage cans of the sea' due to their indiscriminate eating.",
        "They have serrated teeth shaped for tearing tough shell and bone.",
        "Tiger sharks play a key ecological role keeping sea-turtle populations healthy.",
        "They have distinctive dark stripes when young that fade with age.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/TigerShark_Bahamas.jpg/640px-TigerShark_Bahamas.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Blue Shark",
      scientificName: "Prionace glauca",
      habitat: "Deep, open ocean worldwide",
      diet: ["squid", "small fish", "seabirds", "cetaceans"],
      maxLengthM: 3.8,
      maxWeightKg: 205,
      conservationStatus: "Near Threatened",
      funFacts: [
        "Blue sharks are the most widely distributed shark species.",
        "They are known for long transoceanic migrations.",
        "Females have skin three times thicker than males to withstand mating bites.",
        "Blue sharks can give birth to up to 135 pups in a single litter.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Blue_shark_Prionace_glauca_1.jpg/640px-Blue_shark_Prionace_glauca_1.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Nurse Shark",
      scientificName: "Ginglymostoma cirratum",
      habitat: "Shallow, tropical coastal waters; coral reefs",
      diet: ["crustaceans", "mollusks", "fish", "coral"],
      maxLengthM: 3.0,
      maxWeightKg: 110,
      conservationStatus: "Vulnerable",
      funFacts: [
        "Nurse sharks are nocturnal and rest in large groups on the seafloor during the day.",
        "They can remain stationary on the bottom using buccal pumping to breathe.",
        "They have small, serrated teeth ideal for crushing shells.",
        "Nurse sharks are slow and generally harmless to divers.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Nurse_shark.jpg/640px-Nurse_shark.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Shortfin Mako Shark",
      scientificName: "Isurus oxyrinchus",
      habitat: "Offshore temperate and tropical oceans",
      diet: ["bluefish", "tuna", "swordfish", "mackerel", "squid"],
      maxLengthM: 4.0,
      maxWeightKg: 570,
      conservationStatus: "Endangered",
      funFacts: [
        "Mako sharks are the fastest sharks in the ocean, reaching 45 km/h (28 mph).",
        "They are warm-blooded — a rare trait among fish.",
        "Makos can leap up to 9 metres out of the water.",
        "They are highly sought for sport fishing and their meat.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Isurus_oxyrinchus.jpg/640px-Isurus_oxyrinchus.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Zebra Shark",
      scientificName: "Stegostoma tigrinum",
      habitat: "Shallow coral reefs, Indo-Pacific",
      diet: ["mollusks", "crustaceans", "small fish", "sea snakes"],
      maxLengthM: 2.5,
      maxWeightKg: 35,
      conservationStatus: "Endangered",
      funFacts: [
        "Juvenile zebra sharks have stripes; adults develop spots — the opposite of zebras!",
        "They are flexible enough to squeeze into reef crevices to hunt.",
        "Zebra sharks are oviparous — they lay large, dark-brown egg cases.",
        "They can reproduce asexually (parthenogenesis) in captivity.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Stegostoma_fasciatum_1.jpg/640px-Stegostoma_fasciatum_1.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
    {
      commonName: "Greenland Shark",
      scientificName: "Somniosus microcephalus",
      habitat: "Cold, deep Arctic and North Atlantic waters",
      diet: ["fish", "seals", "polar bears (scavenged)", "horses (scavenged)"],
      maxLengthM: 7.3,
      maxWeightKg: 1400,
      conservationStatus: "Vulnerable",
      funFacts: [
        "Greenland sharks may live over 500 years — making them the longest-lived vertebrates on Earth.",
        "They grow only ~1 cm per year.",
        "Their flesh is toxic when fresh due to high concentrations of trimethylamine oxide.",
        "They are nearly blind due to a parasite that lives on their corneas, yet they hunt effectively.",
      ],
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Greenland_shark_NOAA.jpg/640px-Greenland_shark_NOAA.jpg",
      updatedBy: "system",
      createdBy: "system",
    },
  ];

  const now = new Date().toISOString();
  for (const s of sharkData) {
    db.insert(sharks)
      .values({
        ...s,
        diet: serialiseArray(s.diet as string[]),
        funFacts: serialiseArray(s.funFacts as string[]),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // --- Demo comments (seeded to Great White and Whale Shark) ---
  const greatWhiteId = db.select().from(sharks).where(eq(sharks.commonName, "Great White Shark")).get()?.id;
  const whaleSharkId = db.select().from(sharks).where(eq(sharks.commonName, "Whale Shark")).get()?.id;
  const editorUser = db.select().from(users).where(eq(users.username, "editor")).get();
  const viewerUser = db.select().from(users).where(eq(users.username, "viewer")).get();

  if (greatWhiteId && editorUser && viewerUser) {
    const seedComments = [
      { sharkId: greatWhiteId, userId: viewerUser.id, username: viewerUser.username, body: "Saw one of these while cage diving in South Africa — absolutely breathtaking!", createdAt: now },
      { sharkId: greatWhiteId, userId: editorUser.id, username: editorUser.username, body: "Updated the size data to reflect latest IUCN survey figures.", createdAt: now },
    ];
    for (const c of seedComments) {
      db.insert(comments).values(c).run();
    }
  }

  if (whaleSharkId && viewerUser) {
    db.insert(comments).values({
      sharkId: whaleSharkId,
      userId: viewerUser.id,
      username: viewerUser.username,
      body: "Swam alongside one of these gentle giants in the Maldives — life-changing experience!",
      createdAt: now,
    }).run();
  }

  console.log("✅ Demo data seeded successfully.");
}
