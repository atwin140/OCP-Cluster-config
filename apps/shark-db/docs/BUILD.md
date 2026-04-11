# BUILD.md — How to Build and Run Shark Database

## Prerequisites

### Local Development

| Tool | Minimum Version | Install |
|------|-----------------|---------|
| Node.js | 20.x LTS | [nodejs.org](https://nodejs.org) or `nvm use 20` |
| npm | 10.x (comes with Node 20) | Included |
| Git | Any modern | [git-scm.com](https://git-scm.com) |

Optional (for containerised workflow):

| Tool | Minimum Version | Install |
|------|-----------------|---------|
| Docker or Podman | 24+ / 4+ | [docker.com](https://docker.com) |
| kubectl | 1.27+ | [kubernetes.io](https://kubernetes.io/docs/tasks/tools/) |
| oc (OpenShift CLI) | 4.12+ | [mirror.openshift.com](https://mirror.openshift.com/pub/openshift-v4/clients/ocp/) |
| kustomize | 5.x | `brew install kustomize` or bundled with kubectl |

---

## 1. Clone and Install

```bash
git clone https://github.com/your-org/shark-db.git
cd shark-db
npm install
```

---

## 2. Configure Environment

```bash
cp .env.example .env
# Edit .env — the defaults work for local SQLite development
# You do NOT need PostgreSQL or MongoDB for local development
```

Key variables for local development:
```bash
NODE_ENV=development
PORT=8080
SQLITE_PATH=./shark_db.sqlite
SESSION_SECRET=any-random-string-for-dev
```

---

## 3. Run in Development Mode

```bash
npm run dev
```

This starts:
- **Express backend** on port 8080 (API routes at `/api/*`)
- **Vite dev server** (proxied through Express, HMR enabled)

Open: [http://localhost:8080](http://localhost:8080)

The database is seeded automatically on first run. Watch for:
```
🦈 Seeding demo data...
✅ Demo data seeded successfully.
```

**Demo login credentials:**
```
admin  / SharkAdmin123!   (full access)
editor / SharkEdit123!    (create + edit sharks)
viewer / SharkView123!    (view + comment)
```

---

## 4. Run Individual Pieces

```bash
# TypeScript check only
npx tsc --noEmit

# Lint (if ESLint is configured)
npm run lint

# Format
npm run format
```

---

## 5. Build for Production

```bash
npm run build
```

This runs `script/build.ts` which:
1. Runs **Vite** to build the React frontend → `dist/public/`
2. Runs **esbuild** to bundle the Express backend → `dist/index.cjs`

```
dist/
├── public/           # Static frontend files (serve from web server or Nginx)
│   ├── index.html
│   └── assets/
└── index.cjs         # Bundled Express server (includes all backend code)
```

Run the production build locally:
```bash
NODE_ENV=production PORT=8080 node dist/index.cjs
```

---

## 6. Build the Container Image

### Monolith image (recommended for demos)

```bash
# Build
docker build -t shark-db:latest .

# Run
docker run -p 8080:8080 \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v shark-db-data:/app/data \
  shark-db:latest

# Open http://localhost:8080
```

### Push to a registry

```bash
# Quay.io example
docker tag shark-db:latest quay.io/your-org/shark-db:1.0.0
docker push quay.io/your-org/shark-db:1.0.0

# OpenShift internal registry example
docker tag shark-db:latest \
  image-registry.openshift-image-registry.svc:5000/shark-db/shark-db:1.0.0
docker push \
  image-registry.openshift-image-registry.svc:5000/shark-db/shark-db:1.0.0
```

### Build with Podman (rootless — recommended for OpenShift environments)

```bash
podman build -t shark-db:latest .
podman run -p 8080:8080 \
  -e NODE_ENV=production \
  -v shark-db-data:/app/data:Z \   # :Z = SELinux label, required on RHEL/Fedora
  shark-db:latest
```

### OpenShift BuildConfig (build inside the cluster)

```bash
# Create a BuildConfig using binary strategy
oc new-build --name=shark-db --binary --strategy=docker -n shark-db

# Start a build from your local directory
oc start-build shark-db --from-dir=. --follow -n shark-db

# The image is pushed to the internal registry automatically
# Image stream: image-registry.openshift-image-registry.svc:5000/shark-db/shark-db:latest
```

---

## 7. Deploy to Kubernetes / OpenShift

### Option A — Kustomize (recommended)

```bash
# Preview what will be deployed
kubectl kustomize deploy/overlays/dev/

# Apply to cluster
kubectl apply -k deploy/overlays/dev/

# OR for OpenShift
oc apply -k deploy/overlays/dev/

# Watch rollout
kubectl rollout status deployment/shark-db -n shark-db-dev
# OR
oc rollout status deployment/shark-db -n shark-db-dev
```

### Option B — Individual files (for walkthrough / learning)

```bash
# Apply one by one to see what each does
kubectl apply -f deploy/base/namespace.yaml
kubectl apply -f deploy/base/serviceaccount.yaml
kubectl apply -f deploy/base/configmap.yaml
kubectl apply -f deploy/base/secret.yaml
kubectl apply -f deploy/base/pvc.yaml
kubectl apply -f deploy/base/deployment.yaml
kubectl apply -f deploy/base/service.yaml
kubectl apply -f deploy/base/route.yaml
```

### Update the image after a new build

```bash
# Method 1: Edit kustomization.yaml (preferred — GitOps-friendly)
# In deploy/overlays/dev/kustomization.yaml:
#   images:
#     - name: quay.io/sharkdb/shark-db
#       newTag: "1.1.0"   ← change this
# Then commit and push — ArgoCD will pick it up.

# Method 2: Imperative kubectl (NOT GitOps, but useful for quick testing)
kubectl set image deployment/shark-db \
  shark-db=quay.io/your-org/shark-db:1.1.0 \
  -n shark-db
```

---

## 8. ArgoCD Integration

```bash
# Install ArgoCD (if not already installed)
kubectl create namespace argocd
kubectl apply -n argocd -f \
  https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for ArgoCD to be ready
kubectl rollout status deployment/argocd-server -n argocd

# Apply the AppProject and Application
kubectl apply -f argocd/project.yaml -n argocd
kubectl apply -f argocd/application-dev.yaml -n argocd

# Watch ArgoCD sync
argocd app get shark-db-dev
argocd app sync shark-db-dev   # Manual sync if needed
```

---

## 9. Verify the Deployment

```bash
# Check pods are running
kubectl get pods -n shark-db-dev

# Check health endpoint
kubectl exec -n shark-db-dev \
  $(kubectl get pod -n shark-db-dev -l app.kubernetes.io/name=shark-db -o name | head -1) \
  -- wget -qO- http://localhost:8080/api/health

# Get the Route URL (OpenShift)
oc get route shark-db -n shark-db-dev

# Stream logs
kubectl logs -f -l app.kubernetes.io/name=shark-db -n shark-db-dev
```

---

## Troubleshooting

### Pod stuck in `CrashLoopBackOff`

```bash
kubectl describe pod <pod-name> -n shark-db
kubectl logs <pod-name> -n shark-db --previous
```

Common causes:
- Missing environment variables → check ConfigMap and Secret are applied
- SQLite write permission → check PVC is mounted and the init container ran
- Port conflict → ensure PORT=8080 is set (not 80 or 443)

### OpenShift `permission denied` on /app/data

The init container sets correct group permissions. If it fails:
```bash
oc debug deployment/shark-db -n shark-db -- ls -la /app/data
```
Ensure the PVC storageClass supports the access mode and the SCC allows `fsGroup: 0`.

### Image pull failures

```bash
kubectl describe pod <pod-name> | grep "Failed to pull"
```
Either the image tag doesn't exist or the pull secret is missing. For private registries:
```bash
oc create secret docker-registry quay-pull \
  --docker-server=quay.io \
  --docker-username=your-username \
  --docker-password=your-token \
  -n shark-db

oc secrets link default quay-pull --for=pull -n shark-db
```

### ArgoCD Application stuck in `OutOfSync`

```bash
argocd app diff shark-db-dev
argocd app sync shark-db-dev --force
```
