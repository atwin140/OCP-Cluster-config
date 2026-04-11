# SYSADMIN_WALKTHROUGH.md — Operations Guide

This document is for platform engineers and SREs who need to deploy, operate, scale, and troubleshoot the Shark Database application on OpenShift or Kubernetes. It assumes familiarity with `oc` / `kubectl` and basic container concepts.

---

## Deployment Overview

Shark Database is a single-container application (monolith mode) suitable for demo environments. In production, the data layer splits across PostgreSQL and MongoDB.

```
openshift cluster
  └── shark-db (namespace)
       ├── Deployment/shark-db        ← 1 pod, Recreate strategy
       ├── Service/shark-db           ← ClusterIP, port 8080
       ├── Route/shark-db             ← Edge TLS, public URL
       ├── PVC/shark-db-data          ← 1Gi, RWO (SQLite file)
       ├── ConfigMap/shark-db-config  ← Non-sensitive env vars
       ├── Secret/shark-db-secret     ← SESSION_SECRET, DB passwords
       └── ServiceAccount/shark-db-sa ← Least-privilege identity
```

---

## OpenShift-Specific Considerations

### Random UID Enforcement

OpenShift enforces that containers run as a **random, non-root UID** from a range assigned to the namespace. This is controlled by the `restricted` or `restricted-v2` Security Context Constraint (SCC).

Our container handles this by:

1. **Not specifying `runAsUser`** in the Deployment securityContext — OpenShift fills this in with a random UID (e.g., 1000680000)
2. **Setting `fsGroup: 0`** — all processes in the pod have GID 0 (root group)
3. **Making critical directories group-writable** (`chmod g+rw`, `chown :0`) in the Dockerfile and init container — so the arbitrary UID can write to them via GID 0
4. **Using port 8080** — containers cannot bind to ports below 1024 without `NET_BIND_SERVICE` capability, which we do not grant

You can verify the running UID:
```bash
oc exec -n shark-db $(oc get pod -l app.kubernetes.io/name=shark-db -o name | head -1) \
  -- id
# uid=1000680000(?) gid=0(root) groups=0(root)
```

### SCC Compatibility

The Deployment is fully compatible with the `restricted` and `restricted-v2` SCCs:

| Requirement | Our Configuration |
|-------------|-------------------|
| runAsNonRoot | ✅ `runAsNonRoot: true` |
| allowPrivilegeEscalation | ✅ `false` |
| readOnlyRootFilesystem | ✅ `true` (with /tmp emptyDir mount) |
| Capabilities | ✅ All dropped |
| seccompProfile | ✅ RuntimeDefault |
| privileged | ✅ `false` (not set) |

```bash
# Verify SCC assignment
oc get pod -l app.kubernetes.io/name=shark-db -o yaml | grep scc
# openshift.io/scc: restricted-v2
```

If the pod fails to start with SCC errors:
```bash
oc describe pod <pod-name> | grep "forbidden"
oc adm policy who-can use scc restricted-v2 -n shark-db
```

---

## Deploying from Scratch

```bash
# 1. Create the namespace / project
oc new-project shark-db

# 2. Apply base manifests (or use overlay)
oc apply -k deploy/overlays/dev/

# 3. Watch the rollout
oc rollout status deployment/shark-db -n shark-db-dev

# 4. Get the public URL
oc get route shark-db -n shark-db-dev
```

---

## Secrets Management

### Do NOT use the example secret.yaml in production

The `deploy/base/secret.yaml` contains placeholder base64 values. Options for production:

#### Option A: Sealed Secrets (recommended for GitOps)
```bash
# Install Sealed Secrets controller
oc apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Seal a secret
kubectl create secret generic shark-db-secret \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=PG_PASSWORD="mypassword" \
  -n shark-db --dry-run=client -o yaml | \
  kubeseal -o yaml > deploy/base/sealed-secret.yaml

# Now sealed-secret.yaml is safe to commit to Git
git add deploy/base/sealed-secret.yaml
git commit -m "Add sealed secret for shark-db"
```

#### Option B: External Secrets Operator (with Vault / AWS SM)
```bash
oc apply -f https://github.com/external-secrets/external-secrets/releases/latest/download/install.yaml
# Then create ExternalSecret resources that reference your Vault/SM keys
```

#### Option C: Create secrets manually (out-of-band, not in Git)
```bash
oc create secret generic shark-db-secret \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=PG_PASSWORD="your-pg-password" \
  --from-literal=MONGO_PASSWORD="your-mongo-password" \
  -n shark-db
```

---

## Scaling

### Demo / Lab (SQLite)

SQLite is a single-writer database stored on a ReadWriteOnce (RWO) PVC. Only one pod can write to it at a time. The Deployment uses `strategy: Recreate`, meaning:
- The old pod is terminated before the new pod starts
- This prevents two pods from writing to the same SQLite file simultaneously
- **Do not scale SQLite deployments to > 1 replica**

```bash
# Cannot scale SQLite beyond 1 — will cause database corruption
oc scale deployment/shark-db --replicas=1 -n shark-db
```

### Production (PostgreSQL + MongoDB)

With the relational database backend:
```bash
# Scale horizontally — each pod connects to the same PG/Mongo instance
oc scale deployment/shark-db --replicas=3 -n shark-db

# Or use a HorizontalPodAutoscaler
oc autoscale deployment/shark-db \
  --min=2 --max=10 \
  --cpu-percent=60 \
  -n shark-db

# Change strategy to RollingUpdate
oc patch deployment/shark-db -n shark-db --type=json \
  -p='[{"op":"replace","path":"/spec/strategy/type","value":"RollingUpdate"}]'
```

---

## Health Checks

The application exposes `/api/health` for all probe types:

```bash
# Check health directly from inside a pod
oc exec -n shark-db $(oc get pod -l app.kubernetes.io/name=shark-db -o name | head -1) \
  -- wget -qO- http://localhost:8080/api/health

# Expected response:
# {"status":"ok","timestamp":"2026-04-11T13:00:00.000Z","service":"shark-db"}
```

The Deployment defines:

| Probe | Path | Initial Delay | Period | Failure Threshold |
|-------|------|---------------|--------|-------------------|
| Liveness | /api/health | 15s | 30s | 3 |
| Readiness | /api/health | 10s | 10s | 3 |
| Startup | /api/health | 5s | 5s | 12 (=60s) |

The startup probe gives the application 60 seconds to complete database initialisation and seed data loading before liveness/readiness checks begin.

---

## Logs

```bash
# Stream logs from all shark-db pods
oc logs -f -l app.kubernetes.io/name=shark-db -n shark-db

# Previous container logs (after a crash)
oc logs -n shark-db <pod-name> --previous

# Logs from a specific container
oc logs -n shark-db <pod-name> -c shark-db

# Structured log filtering (if log format is JSON)
oc logs -l app.kubernetes.io/name=shark-db -n shark-db | jq 'select(.level == "error")'
```

Log format:
```
12:46:28 PM [express] GET /api/sharks 200 in 3ms :: [{"id":1,...}]
12:46:29 PM [express] POST /api/auth/login 200 in 45ms
```

---

## Storage

### PVC inspection

```bash
# Check PVC status
oc get pvc -n shark-db

# Describe for events and binding details
oc describe pvc shark-db-data -n shark-db

# Check storage usage from inside the pod
oc exec -n shark-db <pod-name> -- df -h /app/data
```

### SQLite database inspection

```bash
# Copy the SQLite file out of the pod for inspection
oc cp shark-db/<pod-name>:/app/data/shark_db.sqlite ./shark_db.sqlite

# Inspect with SQLite CLI
sqlite3 shark_db.sqlite
sqlite> .tables
sqlite> SELECT id, common_name, updated_by, updated_at FROM sharks;
sqlite> SELECT username, role FROM users;
sqlite> .quit
```

### Backup SQLite database

```bash
# Simple file copy
oc exec -n shark-db <pod-name> -- sqlite3 /app/data/shark_db.sqlite ".backup /tmp/backup.sqlite"
oc cp shark-db/<pod-name>:/tmp/backup.sqlite ./shark_db_backup.sqlite
```

---

## Updating the Application

### GitOps workflow (recommended)

```bash
# 1. Build new image in CI
docker build -t quay.io/your-org/shark-db:1.1.0 .
docker push quay.io/your-org/shark-db:1.1.0

# 2. Update the image tag in Git
# In deploy/overlays/dev/kustomization.yaml:
#   images:
#     - name: quay.io/sharkdb/shark-db
#       newTag: "1.1.0"

git commit -am "chore: bump shark-db to 1.1.0"
git push origin main

# 3. ArgoCD detects the change and syncs automatically (dev)
#    For production: argocd app sync shark-db-prod
```

### Imperative update (for quick testing — not GitOps)

```bash
oc set image deployment/shark-db \
  shark-db=quay.io/your-org/shark-db:1.1.0 \
  -n shark-db
oc rollout status deployment/shark-db -n shark-db
```

### Rollback

```bash
# Roll back to previous revision
oc rollout undo deployment/shark-db -n shark-db

# Roll back to a specific revision
oc rollout history deployment/shark-db -n shark-db
oc rollout undo deployment/shark-db --to-revision=3 -n shark-db

# In GitOps: revert the commit and push — ArgoCD syncs the rollback
git revert HEAD
git push origin main
```

---

## Resource Monitoring

```bash
# Pod resource usage
oc adm top pod -n shark-db

# Node usage
oc adm top node

# HPA status (if configured)
oc get hpa -n shark-db
oc describe hpa shark-db -n shark-db
```

---

## Connecting to PostgreSQL and MongoDB (Production Setup)

### PostgreSQL

Deploy with the Bitnami Helm chart or via the Red Hat OpenShift Database Access operator:

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install shark-db-postgres bitnami/postgresql \
  --set auth.database=sharkdb \
  --set auth.username=sharkdb \
  --set auth.password=changeme \
  -n shark-db

# Verify connectivity from the app pod
oc exec -n shark-db <app-pod> -- \
  node -e "const { Pool } = require('pg'); const p = new Pool({connectionString: process.env.DATABASE_URL}); p.query('SELECT 1').then(() => console.log('PG OK'))"
```

### MongoDB

```bash
helm install shark-db-mongodb bitnami/mongodb \
  --set auth.rootPassword=changeme \
  --set auth.database=sharkdb \
  --set auth.username=sharkdb \
  --set auth.password=changeme \
  -n shark-db
```

---

## Troubleshooting Quick Reference

| Symptom | First command to run | Likely cause |
|---------|----------------------|--------------|
| Pod in `Pending` | `oc describe pod <name>` | PVC not bound, insufficient node resources |
| Pod in `CrashLoopBackOff` | `oc logs <pod> --previous` | Env var missing, port conflict, permission error |
| Pod in `OOMKilled` | `oc describe pod <name>` | Memory limit too low — increase in manifests |
| 403 from ArgoCD | `argocd app diff <app>` | RBAC, SCC, or resource quota issue |
| 404 on API routes | `oc get svc && oc get route` | Service selector mismatch or Route not created |
| Data not persisting | `oc get pvc && oc exec ... df /app/data` | PVC not mounted or read-only mount |
| Image pull failure | `oc describe pod` | Wrong image tag, missing pull secret |
