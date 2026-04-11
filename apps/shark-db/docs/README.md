# 🦈 Shark Database

A playful, demo-ready web application for showcasing **GitOps**, **Kubernetes**, and **OpenShift** in workshops and technical walkthroughs.

---

## What Is This?

Shark Database is a full-stack web application that manages a database of shark species. It exists to demonstrate realistic multi-page application behaviour across multiple backing services — without being so complex that it obscures the demo's real subject: GitOps workflows.

### Why Sharks?

Because every good demo needs a theme, and sharks are endlessly interesting: they are ancient, diverse, and endangered — and unlike a generic "TODO app," they give attendees something to actually talk about during a live demo.

---

## Quick Start — Demo

1. Navigate to the deployed app (or run locally — see [BUILD.md](BUILD.md))
2. Use one of the seeded demo credentials:

| Role   | Username | Password         | Can do                                      |
|--------|----------|------------------|---------------------------------------------|
| Admin  | admin    | SharkAdmin123!   | Everything, including deleting sharks       |
| Editor | editor   | SharkEdit123!    | Create and edit shark records               |
| Viewer | viewer   | SharkView123!    | Search, view, and comment                   |

3. Log in and explore:
   - **Search Sharks** — search by name, filter by habitat and conservation status
   - **Shark Detail** — see full species info, fun facts, audit trail, and comments
   - **Edit Shark** — update a record; watch the audit fields update in real time
   - **All Sharks** — tabular directory with audit columns visible

---

## Architecture Overview

```
Browser
  ↓ HTTPS
OpenShift Route / Kubernetes Ingress
  ↓
Express.js (Node 20)          ← serves React SPA + API
  ├── /api/auth/*             ← login, register, session
  ├── /api/sharks/*           ← shark CRUD + audit
  └── /api/sharks/:id/comments
  ↓
SQLite (demo) / PostgreSQL + MongoDB (production)
```

In production on OpenShift, the data layer splits:
- **PostgreSQL** — shark records (structured, relational, audit-trailed)
- **MongoDB** — users, sessions, comments (document model, user-generated content)

See [ARCHITECTURE.md](ARCHITECTURE.md) for full detail.

---

## Repository Structure

```
shark-db/
├── client/                     # React frontend (Vite + Tailwind + shadcn/ui)
│   └── src/
│       ├── components/         # Shared UI components (Navbar, SharkLogo, etc.)
│       ├── lib/                # Auth context, query client, utilities
│       └── pages/              # LoginPage, SearchPage, SharkDetailPage, EditSharkPage
├── server/                     # Express backend (Node.js)
│   ├── index.ts                # Server entrypoint
│   ├── routes.ts               # All API routes
│   └── storage.ts              # DB abstraction layer + seed data
├── shared/                     # Shared TypeScript types and Zod schemas
│   └── schema.ts
├── deploy/                     # Kubernetes / OpenShift manifests (Kustomize)
│   ├── base/                   # Base manifests (Deployment, Service, Route, etc.)
│   └── overlays/               # Environment-specific patches
│       ├── dev/
│       └── prod/
├── argocd/                     # ArgoCD Application and AppProject manifests
├── docs/                       # Documentation
│   ├── README.md               # This file
│   ├── BUILD.md                # How to build from source
│   ├── DEVELOPER_WALKTHROUGH.md
│   ├── SYSADMIN_WALKTHROUGH.md
│   └── ARCHITECTURE.md
├── Dockerfile                  # Multi-stage production image
├── Dockerfile.frontend         # Optional: Nginx static frontend image
├── nginx.conf                  # Nginx config for Dockerfile.frontend
└── .env.example                # Environment variable template
```

---

## Documentation

| Document | Audience | Contents |
|----------|----------|----------|
| [BUILD.md](BUILD.md) | Everyone | Prerequisites, build steps, running locally, building images |
| [DEVELOPER_WALKTHROUGH.md](DEVELOPER_WALKTHROUGH.md) | Developers | Codebase tour, adding features, data model, API routes |
| [SYSADMIN_WALKTHROUGH.md](SYSADMIN_WALKTHROUGH.md) | SRE / Ops | OpenShift deployment, scaling, secrets, logs, health checks |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Both | Full system design, database strategy, GitOps flow |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React + Vite + Tailwind CSS + shadcn/ui | Fast builds, familiar stack, beautiful defaults |
| Backend API | Node.js + Express | Lightweight, easy to read and explain |
| Demo DB | SQLite (via better-sqlite3 + Drizzle ORM) | Zero infrastructure, runs anywhere |
| Production DB | PostgreSQL (sharks) + MongoDB (users) | Demonstrates the database-per-domain pattern |
| Container | Docker multi-stage | Small images, reproducible builds |
| Orchestration | Kubernetes / OpenShift | Native cloud deployment target |
| GitOps | ArgoCD + Kustomize | Pull-based deployments, declarative state |

---

## GitOps in 30 Seconds

```
Developer pushes to Git
        ↓
ArgoCD detects drift (Git ≠ cluster)
        ↓
ArgoCD syncs: applies Kustomize manifests
        ↓
New pod runs with updated image or config
        ↓
Shark record shows new updated_by / updated_at
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full GitOps narrative.
