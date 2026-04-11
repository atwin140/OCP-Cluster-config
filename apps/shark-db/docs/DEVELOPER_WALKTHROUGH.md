# DEVELOPER_WALKTHROUGH.md — Codebase Tour for New Developers

This walkthrough explains how the application is structured, where each piece lives, and how to make common changes. It assumes basic familiarity with TypeScript and React but does not assume OpenShift or GitOps experience.

---

## Mental Model

```
Client (React + Vite)
  ↓  HTTP (fetch via TanStack Query)
Server (Express + Node.js)
  ↓  Drizzle ORM / better-sqlite3
SQLite file (shark_db.sqlite)
```

In production, SQLite is replaced with PostgreSQL (sharks) and MongoDB (users/comments). The storage abstraction layer (`server/storage.ts`) is the only place that changes — routes and the client don't care which database is underneath.

---

## Repository Layout

```
shark-db/
├── client/                 # Everything the browser runs
│   └── src/
│       ├── App.tsx         # Root: router, providers, auth state
│       ├── index.css       # Tailwind + CSS custom properties (color palette)
│       ├── main.tsx        # React root mount
│       ├── components/     # Reusable UI components
│       │   ├── Navbar.tsx
│       │   ├── SharkLogo.tsx
│       │   └── StatusBadge.tsx
│       ├── lib/
│       │   ├── auth.ts     # AuthContext type definitions and useAuth hook
│       │   ├── queryClient.ts  # TanStack Query client + apiRequest helper
│       │   └── utils.ts    # formatDate, statusClass, constants
│       ├── hooks/
│       │   └── use-toast.ts    # Toast notification hook (from shadcn template)
│       └── pages/
│           ├── LoginPage.tsx       # Welcome / login / register
│           ├── SearchPage.tsx      # Shark search + card grid
│           ├── AllSharksPage.tsx   # Tabular directory
│           ├── SharkDetailPage.tsx # Full detail + comments
│           ├── EditSharkPage.tsx   # Create / edit form
│           └── not-found.tsx       # 404 page
│
├── server/
│   ├── index.ts        # Express app + server entrypoint
│   ├── routes.ts       # All API route definitions
│   ├── storage.ts      # Database abstraction layer + seed data
│   └── vite.ts         # Vite dev server integration (do not edit)
│
├── shared/
│   └── schema.ts       # Database schema, Zod schemas, TypeScript types
│                       # (used by BOTH client and server)
│
├── Dockerfile          # Multi-stage production image
└── package.json        # Scripts, dependencies
```

---

## Data Flow — Reading a Shark

1. User navigates to `/sharks/3`
2. `SharkDetailPage` mounts and calls:
   ```tsx
   useQuery({ queryKey: ['/api/sharks/3'] })
   ```
3. TanStack Query calls `apiRequest('GET', '/api/sharks/3')` via `queryClient.ts`
4. Express matches `GET /api/sharks/:id` in `routes.ts`
5. Route calls `storage.getSharkById(3)`
6. `SqliteStorage.getSharkById` runs: `db.select().from(sharks).where(eq(sharks.id, 3)).get()`
7. Returns parsed shark object (JSON arrays parsed from stored JSON strings)
8. Route sends the response as JSON
9. TanStack Query caches the result and returns it to the component
10. React renders the detail page

---

## Data Flow — Editing a Shark

1. User (editor/admin) clicks "Edit Record" on a shark detail page
2. Navigates to `/sharks/3/edit`
3. `EditSharkPage` fetches the current shark data to pre-populate the form
4. User changes `conservationStatus` from "Vulnerable" to "Endangered"
5. User clicks "Save Changes"
6. `useMutation` calls `apiRequest('PUT', '/api/sharks/3', { conservationStatus: 'Endangered' })`
7. Express route at `PUT /api/sharks/:id`:
   - Validates the request body with Zod
   - Calls `requireEditorOrAdmin` middleware (checks token → session → user role)
   - Calls `storage.updateShark(3, { conservationStatus: 'Endangered' }, 'editor')`
8. `updateShark` runs the Drizzle UPDATE and sets:
   - `conservationStatus = 'Endangered'`
   - `updatedAt = new Date().toISOString()`
   - `updatedBy = 'editor'` (from the authenticated user)
9. Returns the updated shark
10. `useMutation.onSuccess`:
    - Invalidates the `['/api/sharks/3']` cache key (forces a fresh fetch)
    - Shows a toast notification
    - Navigates back to the detail page
11. Detail page re-fetches and shows the new status + updated audit fields

---

## The Shared Schema (`shared/schema.ts`)

This file is the single source of truth for:
- **Database table definitions** (Drizzle SQLite tables)
- **Zod validation schemas** (used in routes to validate request bodies)
- **TypeScript types** (used in both frontend and backend)

It is compiled separately and imported by both `client/` and `server/` via the `@shared` TypeScript path alias.

Key types:
```typescript
type Shark    // A shark row from the database (all fields)
type InsertShark  // What you send to create/update a shark (no auto fields)
type User     // A user row (never includes passwordHash in API responses)
type Comment  // A comment row
```

### Adding a new field to Shark

1. Add the column to `sqliteTable("sharks", {...})` in `schema.ts`
2. Add it to `insertSharkSchema` if users should be able to set it
3. Run the app — the init script will need to include the new column in the `CREATE TABLE` SQL in `storage.ts`
4. Update the edit form in `EditSharkPage.tsx` to include the field
5. Update the detail page in `SharkDetailPage.tsx` to display it
6. The API and types update automatically from the schema

---

## Authentication Flow

Auth uses a simple in-memory session store for the demo (not Redis, not a database).

```
POST /api/auth/login
  → validates credentials with bcrypt.compareSync
  → creates a token: random string
  → stores: sessions.set(token, { userId, expiresAt: now + 24h })
  → returns { token, user }

Frontend stores token in React state (not localStorage — blocked in iframes)
Every API request includes: Authorization: Bearer <token>

requireAuth middleware:
  → reads Authorization header
  → looks up token in sessions map
  → checks expiry
  → attaches user to req.currentUser
  → calls next()
```

In production, replace the in-memory `sessions` Map with:
- A MongoDB-backed session store (using `connect-mongo`)
- Or JWT tokens (stateless, no server-side storage needed)

---

## API Routes Reference

All routes are in `server/routes.ts`:

| Method | Path | Auth Required | Role | Description |
|--------|------|---------------|------|-------------|
| POST | `/api/auth/login` | No | — | Login with username + password |
| POST | `/api/auth/register` | No | — | Create new viewer account |
| POST | `/api/auth/logout` | No | — | Invalidate session token |
| GET | `/api/auth/me` | Yes | any | Get current user info |
| GET | `/api/health` | No | — | Liveness/readiness probe |
| GET | `/api/sharks` | No | — | List/search sharks |
| GET | `/api/sharks/:id` | No | — | Single shark detail |
| POST | `/api/sharks` | Yes | editor/admin | Create new shark |
| PUT | `/api/sharks/:id` | Yes | editor/admin | Update shark record |
| DELETE | `/api/sharks/:id` | Yes | admin | Delete a shark |
| GET | `/api/sharks/:id/comments` | No | — | List comments |
| POST | `/api/sharks/:id/comments` | Yes | any | Post a comment |

Search parameters for `GET /api/sharks`:
- `?search=great+white` — search common name and scientific name
- `?habitat=coral` — filter by habitat (substring match)
- `?status=Endangered` — filter by exact conservation status

---

## Frontend State Management

The app uses three layers of state:

1. **React state** (`useState`) — local component state (form values, modal open/closed)
2. **React context** (`AuthContext`) — global auth state (current user, token, role)
3. **TanStack Query** — server state (cached API responses, loading/error states)

### Auth context pattern

```tsx
// Reading auth state anywhere in the component tree:
const { user, isAuthenticated, isEditor, isAdmin, login, logout } = useAuth();

// After a successful login API call:
setAuthToken(token);   // sets the module-level token for apiRequest
login(token, user);    // updates React context state
```

### TanStack Query pattern

```tsx
// Fetch data:
const { data: sharks, isLoading, error } = useQuery<SharkWithArrays[]>({
  queryKey: ['/api/sharks'],
});

// Mutate data:
const mutation = useMutation({
  mutationFn: async (payload) => {
    const res = await apiRequest('PUT', '/api/sharks/1', payload);
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/sharks/1'] });
  },
});
```

---

## Audit Fields — Why They Matter

Every shark record has:
- `created_at` — ISO 8601 timestamp, set on creation, never changed
- `created_by` — username of who created the record
- `updated_at` — ISO 8601 timestamp, updated on every PUT
- `updated_by` — username of whoever last changed the record

These are automatically stamped in `storage.updateShark()`:
```typescript
const now = new Date().toISOString();
const patch = { ...data, updatedAt: now, updatedBy };
db.update(sharks).set(patch).where(eq(sharks.id, id)).returning().get();
```

During a GitOps demo, you can:
1. Log in as "editor"
2. Edit a shark's conservation status
3. Immediately show the detail page — the audit block now shows `Updated by: editor` with a current timestamp
4. Explain: "In a real pipeline, this would be the CI system's service account — not a human. The same principle applies to Kubernetes manifests managed by ArgoCD."

---

## Adding a New Feature — Example: Add a "range map URL" field

1. **Schema** (`shared/schema.ts`):
   ```typescript
   rangeMapUrl: text("range_map_url"),
   ```

2. **Storage** (`server/storage.ts`) — add to `CREATE TABLE` SQL:
   ```sql
   range_map_url TEXT,
   ```

3. **Edit form** (`EditSharkPage.tsx`) — add an Input field for the URL

4. **Detail page** (`SharkDetailPage.tsx`) — render it as a map link

5. **Test** — edit a shark, save, and confirm the URL appears on the detail page

That's the full cycle. No code generators, no scaffolding commands.

---

## Running Tests

No automated tests are included in this demo. For a production application, add:

- **Unit tests** for storage layer functions: `vitest` + `better-sqlite3` in-memory DB
- **API integration tests**: `supertest` against the Express app
- **E2E tests**: Playwright — test the full login → edit → audit trail workflow

```bash
# When tests are added:
npm test           # vitest
npm run test:e2e   # playwright
```

---

## Code Style

- TypeScript strict mode is enabled
- Imports use path aliases: `@/` for `client/src/`, `@shared/` for `shared/`
- Components are function components with explicit TypeScript props
- Mutations use `useMutation`; reads use `useQuery`
- Never use `localStorage` or `sessionStorage` (blocked in iframe deployments)
- API calls always go through `apiRequest` (never raw `fetch()`)
