# ARCHITECTURE.md — System Design and GitOps Flow

---

## 1. Why This Stack?

### React + Vite (frontend)
- The most common frontend stack in 2025 — anyone can read and contribute to it
- Vite's development server is fast and requires zero configuration to explain
- Tailwind CSS + shadcn/ui produces a polished, accessible UI without custom CSS sprawl
- Hash-based routing (`/#/sharks/1`) works correctly when served as a static bundle

### Express + Node.js (backend)
- Lightweight, readable API layer
- Easy to demonstrate middleware chains (`requireAuth → requireEditorOrAdmin → route handler`)
- Single language (TypeScript) across frontend, backend, and shared schema — reduces cognitive load for new developers
- No framework magic — routes are explicit functions, easy to trace during a demo

### SQLite for demo / PostgreSQL + MongoDB for production
- **Demo**: SQLite runs with zero infrastructure. Fire up the container, it works.
- **Production**: The data domain split maps naturally to the right database technology
  - **PostgreSQL** for shark records: structured data, relational integrity, ACID transactions, audit trail
  - **MongoDB** for users and comments: flexible document model, easy to scale horizontally, natural fit for user-generated content with varying schemas

### Drizzle ORM
- Type-safe SQL queries — the TypeScript compiler catches schema mismatches before deployment
- Schema-as-code in `shared/schema.ts` — single place to view and change the data model
- Compatible with both SQLite (demo) and PostgreSQL (production) — swap the driver, not the query syntax

### Kustomize (not Helm)
- Kustomize is built into `kubectl` — no additional tooling required
- Overlays are easy to explain: "this is the base, this is what we change for prod"
- No templating engine to learn — patches are plain YAML
- For more complex parameterization needs, Helm is a straightforward upgrade path

### ArgoCD
- The de facto standard GitOps tool for Kubernetes/OpenShift
- Installed on most enterprise OpenShift clusters already (via GitOps Operator)
- Application CRD maps directly to "a folder in Git" — easy to explain and demo
- UI shows drift, sync status, and resource graph clearly

---

## 2. Application Architecture

### Request Flow (production)

```
User's browser
      ↓  HTTPS
  OpenShift Route (HAProxy)  ←  TLS termination (edge mode)
      ↓  HTTP :8080
  Service/shark-db  →  Deployment/shark-db (1+ pods)
      ↓
  Express.js process
    ├── Static file serving (React SPA from dist/public/)
    ├── /api/auth/*       ← validates credentials, manages sessions
    ├── /api/sharks/*     ← shark CRUD + audit stamps
    └── /api/sharks/:id/comments  ← user comments
      ↓
  ┌─────────────────────┬────────────────────────┐
  │ PostgreSQL           │ MongoDB                │
  │ Table: sharks        │ Collection: users      │
  │ (structured data,    │ Collection: comments   │
  │  audit trail)        │ (documents, flexible   │
  │                      │  schema, easy sharding)│
  └─────────────────────┴────────────────────────┘
```

### Data Domain Separation

| Domain | Database | Reason |
|--------|----------|--------|
| Shark records | PostgreSQL | Structured, relational, benefits from ACID transactions and JOIN queries. Audit trail requires reliable timestamps and update tracking. |
| Users / Auth | MongoDB | User profiles are document-shaped (flexible roles, future profile fields). Session data maps naturally to MongoDB TTL collections. |
| Comments | MongoDB | User-generated content varies in structure. MongoDB's flexible schema means no migrations needed as comment features evolve. |

### Why Not One Database?

Using a single database is simpler for a demo but less instructive. The intentional split:
1. Demonstrates **database-per-domain** (a microservices pattern even in a monolith)
2. Shows that PostgreSQL and MongoDB serve different use cases
3. Gives you something interesting to say during the demo: "Notice that auth data and shark data are in different stores — that boundary would survive a service split"

---

## 3. GitOps Architecture

### Repository Structure

```
shark-db/                         ← Monorepo (source + manifests)
├── client/                       ← Application source
├── server/
├── shared/
├── Dockerfile
├── deploy/                       ← GitOps manifests
│   ├── base/                     ← Shared base config
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── route.yaml
│   │   └── kustomization.yaml
│   └── overlays/
│       ├── dev/                  ← Dev-specific patches
│       │   └── kustomization.yaml
│       └── prod/                 ← Prod-specific patches
│           └── kustomization.yaml
└── argocd/                       ← ArgoCD resources
    ├── project.yaml
    ├── application-dev.yaml
    ├── application-prod.yaml
    └── applicationset.yaml
```

### Alternative: Split Repo Pattern

Some teams prefer a separate config repository:
```
shark-db-app/    ← Source code only (push to trigger CI)
shark-db-config/ ← Manifests only (ArgoCD watches this)
```

The split-repo pattern is cleaner for large teams (separate access controls for source vs. deployment) but adds complexity. For demos, the monorepo is easier to follow.

---

## 4. GitOps Change Flows

### Flow 1 — Code Change (new feature / bug fix)

```
Developer
  │
  ├── git push feature-branch
  │
  ↓
CI Pipeline (GitHub Actions / Tekton / Jenkins)
  ├── npm test
  ├── npm run build
  ├── docker build -t quay.io/org/shark-db:abc123 .
  ├── docker push
  │
  ↓
CD Step (CI or separate GitOps PR)
  ├── git checkout main
  ├── yq e '.images[0].newTag = "abc123"' \
  │     deploy/overlays/dev/kustomization.yaml
  ├── git commit -m "ci: update shark-db image to abc123"
  └── git push origin main
  │
  ↓
ArgoCD (watching deploy/overlays/dev on main branch)
  ├── detects: kustomization.yaml changed
  ├── renders: kubectl kustomize deploy/overlays/dev/
  ├── compares rendered manifests to cluster state → DRIFT DETECTED
  ├── syncs: applies updated Deployment to cluster
  └── pod replaces: new image pulls, container restarts

Result: new code running in dev within ~2 minutes of push
```

### Flow 2 — Manifest-Only Change (config change, no rebuild)

This is where GitOps shines. Example: increase memory limit for the production deployment.

```
Platform Engineer
  │
  ├── edits deploy/overlays/prod/kustomization.yaml
  │     memory limit: 512Mi → 1Gi
  ├── git commit -m "feat: increase prod memory limit for load testing"
  └── git push origin v1.3.0 (tag)
  │
  ↓
ArgoCD (watching deploy/overlays/prod on tag v1.3.0)
  ├── detects: memory limit changed in rendered manifest
  ├── shows: DRIFT (cluster has 512Mi, Git has 1Gi)
  │
  ↓
Platform Engineer reviews ArgoCD diff in UI
  │
  └── clicks Sync (production is manual-sync only)
  │
  ↓
ArgoCD applies Deployment patch → Kubernetes updates resource limits
  └── no pod restart unless spec.template changes

Result: memory limit updated without a rebuild or redeployment of code
```

This demonstrates the key GitOps principle: **the Git repository is the single source of truth**. The cluster always converges toward Git — not toward what someone typed in a terminal.

### Flow 3 — Rollback

```
Incident detected: new deployment broke shark search
  │
  ↓
Option A (GitOps rollback — recommended):
  ├── git revert HEAD (reverts the bad image tag commit)
  ├── git push
  └── ArgoCD auto-syncs → cluster rolls back to previous image

Option B (Emergency imperative rollback):
  ├── oc rollout undo deployment/shark-db -n shark-db
  └── (follow up with GitOps fix to bring Git back in sync)

Note: ArgoCD will show DRIFT after Option B until Git is updated.
This drift is intentional — it reminds you to fix the source of truth.
```

---

## 5. How Audit Fields Tell the GitOps Story

The shark record's `updated_by` and `updated_at` fields are a micro-level mirror of the GitOps change-tracking concept.

In a GitOps pipeline:
- Git commit author = `updated_by`
- Git commit timestamp = `updated_at`
- Git diff = what changed

On the shark detail page:
- `Updated by: editor` shows who made the API call
- `Updated at: Apr 11, 2026 · 12:46 PM` shows when
- The before/after of the edit is visible in the UI

During a demo, you can connect these:
> "When our CI pipeline updates the image tag in Git, ArgoCD logs the sync event — who synced, when, what changed. It's the same pattern as these audit fields: every change has an author and a timestamp. Git is the audit trail for your infrastructure, just like updated_by is the audit trail for this shark record."

---

## 6. Security Model

### Network policy (not included, but recommended)

For production, add a NetworkPolicy to restrict ingress to the app pod:
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shark-db-netpol
  namespace: shark-db
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: shark-db
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: openshift-ingress
      ports:
        - port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: shark-db-postgres
      ports:
        - port: 5432
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: shark-db-mongodb
      ports:
        - port: 27017
```

### Secret handling

1. Session secret is a random hex string — rotate it periodically
2. Database passwords use Sealed Secrets or External Secrets Operator
3. Never store real credentials in Git, even encrypted (unless using SealedSecrets which are designed for this)
4. The `ServiceAccount` has `automountServiceAccountToken: false` — the app cannot call the Kubernetes API

---

## 7. Known Limitations

1. **SQLite is single-writer** — the demo cannot scale beyond 1 replica without migrating to PostgreSQL
2. **In-memory session store** — server restart clears all sessions (users must log in again); use MongoDB session store in production
3. **No image upload** — shark images are URLs pointing to external sources; no file upload mechanism
4. **No email verification** — registration requires no email confirmation
5. **No rate limiting** — add `express-rate-limit` middleware for production
6. **No CSRF protection** — the SPA + Bearer token pattern is CSRF-safe by nature, but add `helmet.js` for additional headers

---

## 8. Future Improvements

| Priority | Improvement | Effort |
|----------|-------------|--------|
| High | Migrate to PostgreSQL + MongoDB | Medium |
| High | Add Sealed Secrets for credential management | Low |
| High | Add NetworkPolicy manifests | Low |
| Medium | CI pipeline (GitHub Actions / Tekton) for image builds | Medium |
| Medium | Prometheus metrics endpoint (`/metrics`) | Low |
| Medium | HorizontalPodAutoscaler configuration | Low |
| Low | Email verification on registration | Medium |
| Low | Rate limiting middleware | Low |
| Low | Shark image upload to S3/MinIO | High |
| Low | Admin user management page | Medium |
