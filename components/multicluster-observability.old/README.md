# Multicluster Observability (ACM) — Setup Walkthrough

This component deploys ACM multicluster observability on the hub cluster using
ArgoCD (openshift-gitops). It provisions a full Thanos stack backed by object
storage (MinIO) and iSCSI block storage (Synology CSI).

---

## Prerequisites

| Requirement | Details |
|---|---|
| ACM Hub | `advanced-cluster-management` operator installed, version ≥ 2.9 |
| ArgoCD | `openshift-gitops` operator installed |
| Object storage | MinIO (or S3-compatible) with a bucket and credentials |
| Block storage | A `StorageClass` that provisions RWO PVCs — used for Thanos receive/store shards (iSCSI recommended) |
| NFS/RWO storage | A second `StorageClass` for alertmanager, rules, compact PVCs |
| Sealed Secrets | `sealed-secrets-controller` running (for sealed credential files) |

---

## Architecture

```
ACM Hub
  └── ArgoCD apps
        ├── hub-minio          → MinIO deployment (object storage backend)
        └── hub-multicluster-observability → MultiClusterObservability CR
                                              └── Thanos stack
                                                    ├── receive (3x, iSCSI)
                                                    ├── store shards (3x, iSCSI)
                                                    ├── compact, rule, alertmanager (NFS)
                                                    └── query, grafana, rbac-proxy
```

Managed clusters each run a `metrics-collector` agent that forwards Prometheus
metrics to the hub Thanos receive endpoint over mTLS.

---

## Step 1 — Deploy MinIO (object storage)

MinIO provides the S3-compatible backend for Thanos long-term metric storage.

**Argo app path:** `components/minio/overlays/hub`

### 1a. Seal the MinIO credentials

The MinIO root user/password and the Thanos object storage config are stored as
`SealedSecret` resources. Before committing, generate them:

```bash
# MinIO access credentials (used by the MinIO deployment itself)
kubectl create secret generic minio-credentials \
  --from-literal=MINIO_ROOT_USER=<user> \
  --from-literal=MINIO_ROOT_PASSWORD=<password> \
  --dry-run=client -o yaml \
  | kubeseal --controller-namespace kube-system -o yaml \
  > components/minio/base/minio-credentials-sealed.yaml

# Thanos object storage config (used by MCO to read/write metrics)
# thanos.yaml format:
#   type: S3
#   config:
#     bucket: thanos
#     endpoint: minio.<namespace>.svc:9000
#     access_key: <user>
#     secret_key: <password>
#     insecure: true
kubectl create secret generic thanos-object-storage \
  --from-file=thanos.yaml=./thanos.yaml \
  -n open-cluster-management-observability \
  --dry-run=client -o yaml \
  | kubeseal --controller-namespace kube-system -o yaml \
  > components/minio/base/thanos-object-storage-sealed.yaml
```

### 1b. Commit and sync

```bash
git add components/minio/base/
git commit -m "feat: minio sealed credentials"
git push origin main
# ArgoCD will auto-sync hub-minio
```

### 1c. Verify MinIO is healthy

```bash
export KUBECONFIG=~/.kube/acm
oc -n open-cluster-management-observability get deploy minio
# Expected: 1/1 Running

oc -n open-cluster-management-observability get route minio-console
# Open the console URL to confirm the 'thanos' bucket exists
```

---

## Step 2 — Prepare the iSCSI StorageClass

The Thanos receive StatefulSet and store shards each request 100 Gi / 10 Gi
iSCSI volumes. Formatting a fresh iSCSI LUN via `mke2fs` takes **15–25 minutes**
on Synology hardware — this exceeds kubelet's default 2-minute CSI timeout.

**Pre-format each new LUN manually** after it is provisioned but before the pod
mounts it:

```bash
# Find the block device for a newly provisioned PVC
NODE=acm-controlplane03
PVC_NAME=data-observability-thanos-receive-default-0

# Get the volume name from the PVC
VOLUME=$(oc -n open-cluster-management-observability get pvc $PVC_NAME \
  -o jsonpath='{.spec.volumeName}')

# Get the iSCSI IQN from the PV
IQN=$(oc get pv $VOLUME -o jsonpath='{.spec.csi.volumeHandle}')
echo "IQN suffix: $IQN"

# SSH to node or use oc debug to find the block device and format it
oc debug node/$NODE --image=registry.access.redhat.com/ubi9/ubi -- bash -c \
  "chroot /host bash -c 'DEVICE=/dev/disk/by-path/ip-10.0.0.3:3260-iscsi-iqn.2000-01.com.synology:nas.$IQN-lun-1; \
   pids=\$(fuser \$DEVICE 2>/dev/null); [ -n \"\$pids\" ] && kill -9 \$pids; \
   mkfs.ext4 -F -m0 \$DEVICE && echo FORMAT-DONE'"
# This takes ~20 minutes for a 100 Gi LUN — wait for FORMAT-DONE
```

After formatting, recycle the StatefulSet pod so kubelet mounts the now-formatted
volume:

```bash
oc -n open-cluster-management-observability delete pod \
  observability-thanos-receive-default-0 --wait=false
```

---

## Step 3 — Deploy MultiClusterObservability

**Argo app path:** `components/multicluster-observability/overlays/hub`

### 3a. Review the CR

`components/multicluster-observability/base/multicluster-observability.yaml`:

```yaml
apiVersion: observability.open-cluster-management.io/v1beta2
kind: MultiClusterObservability
metadata:
  name: observability
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  observabilityAddonSpec:
    enableMetrics: true
    interval: 300        # scrape interval in seconds
    workers: 1
    scrapeSizeLimitBytes: 1073741824
  storageConfig:
    storageClass: nas-iscsi-ext4-vol2   # iSCSI SC for receive/store
    metricObjectStorage:
      key: thanos.yaml
      name: thanos-object-storage       # sealed secret from Step 1b
```

> **Important:** Do **not** use `observabilityAddonSpec: {}`. ArgoCD's
> server-side apply migration converts an empty object to `null`, which fails
> MCO schema validation. Always specify at least one field explicitly.

### 3b. ArgoCD RBAC for MCO

ArgoCD needs cluster-scope patch rights on `MultiClusterObservabilities`.
Apply this once on the hub:

```bash
cat <<'EOF' | oc apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: openshift-gitops-mco-manager
rules:
- apiGroups: ["observability.open-cluster-management.io"]
  resources: ["multiclusterobservabilities"]
  verbs: ["get","list","watch","create","update","patch","delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: openshift-gitops-mco-manager
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: openshift-gitops-mco-manager
subjects:
- kind: ServiceAccount
  name: openshift-gitops-argocd-application-controller
  namespace: openshift-gitops
EOF
```

### 3c. Sync options required

The Argo `Application` must include `ServerSideApply=true` to avoid the
client-side apply migration bug:

```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
  syncOptions:
  - CreateNamespace=true
  - ServerSideApply=true
```

### 3d. Commit and sync

```bash
git add components/multicluster-observability/
git commit -m "feat: multicluster-observability CR"
git push origin main
# ArgoCD will auto-sync hub-multicluster-observability
```

### 3e. Verify stack is healthy

```bash
export KUBECONFIG=~/.kube/acm

# MCO conditions — both should show Ready=True
oc get multiclusterobservability observability \
  -o jsonpath='{range .status.conditions[*]}{.type}{"\t"}{.status}{"\t"}{.reason}{"\n"}{end}'

# All Thanos pods should be Running
oc -n open-cluster-management-observability get pods

# Argo app should be Synced/Healthy
oc -n openshift-gitops get application hub-multicluster-observability \
  -o jsonpath='{.status.sync.status}{"\t"}{.status.health.status}{"\n"}'
```

---

## Step 4 — Verify managed cluster addons

Each managed cluster automatically gets an `ObservabilityAddon` and
`ManagedClusterAddon` once MCO is healthy.

```bash
# Should show Available=True for all managed clusters
oc get managedclusteraddon -A | grep observability-controller

# Check per-cluster metrics forwarding
oc get observabilityaddon -A
# Look for condition MetricsCollector=True / ForwardSuccessful
```

### local-cluster (hub) special case

In ACM 2.14+, the hub's `local-cluster` does **not** automatically get an
`ObservabilityAddon`. Create it manually:

```bash
# ObservabilityAddon for the hub
cat <<'EOF' | oc apply -f -
apiVersion: observability.open-cluster-management.io/v1beta1
kind: ObservabilityAddon
metadata:
  name: observability-addon
  namespace: local-cluster
spec:
  enableMetrics: true
  interval: 300
  scrapeSizeLimitBytes: 1073741824
  workers: 1
EOF

# ManagedClusterAddon so ACM Fleet Management shows the hub
cat <<'EOF' | oc apply -f -
apiVersion: addon.open-cluster-management.io/v1alpha1
kind: ManagedClusterAddOn
metadata:
  name: observability-controller
  namespace: local-cluster
spec: {}
EOF
```

---

## Step 5 — Access the dashboards

| URL | Description |
|---|---|
| `https://grafana-open-cluster-management-observability.apps.<hub-domain>/d/2b679d600f3b9e7676a7c5ac3643d448/acm-clusters-overview` | ACM Clusters Overview (all clusters) |
| `https://minio-console-open-cluster-management-observability.apps.<hub-domain>` | MinIO console (bucket browser) |

In the **ACM Console → Infrastructure → Clusters**, each cluster row shows a
**Grafana** launch link once its `ManagedClusterAddon` is `Available`.

---

## Troubleshooting

### Argo sync fails: `spec.observabilityAddonSpec: Invalid value: "null"`

**Cause:** ArgoCD client-side apply migration converts `observabilityAddonSpec: {}`
to `null`.

**Fix:**
1. Ensure `ServerSideApply=true` is in the Application `syncOptions`.
2. Replace `observabilityAddonSpec: {}` with explicit fields (see Step 3a).
3. Remove the stale kubectl annotation from the live object:
   ```bash
   oc annotate multiclusterobservabilities.observability.open-cluster-management.io \
     observability kubectl.kubernetes.io/last-applied-configuration-
   ```

### Thanos receive pod stuck in `ContainerCreating`

**Cause:** `mke2fs` formatting a 100 Gi iSCSI LUN takes ~20 minutes — kubelet
times out after 2 minutes, leaving the disk unformatted.

**Fix:** Pre-format the disk manually (see Step 2).

### iSCSI device I/O hangs (`blkid`, `mkfs` stuck)

**Cause:** Stale iSCSI session after a transient Synology DSM error.

**Fix:** Reset the session on the node:
```bash
NODE=acm-controlplane03
IQN_SUFFIX=<pvc-uuid>

oc debug node/$NODE --image=registry.access.redhat.com/ubi9/ubi -- bash -c \
  "chroot /host bash -c '
    kill -9 \$(fuser /dev/disk/by-path/ip-10.0.0.3:3260-iscsi-iqn.2000-01.com.synology:nas.$IQN_SUFFIX-lun-1 2>/dev/null)
    iscsiadm -m node -T iqn.2000-01.com.synology:nas.$IQN_SUFFIX -p 10.0.0.3:3260 --logout
    iscsiadm -m node -T iqn.2000-01.com.synology:nas.$IQN_SUFFIX -p 10.0.0.3:3260 --login
    timeout 10 dd if=/dev/disk/by-path/ip-10.0.0.3:3260-iscsi-iqn.2000-01.com.synology:nas.$IQN_SUFFIX-lun-1 \
      bs=512 count=8 of=/dev/null && echo IO-OK'"
```

### local-cluster not visible in ACM Fleet Management

**Fix:** Create the `ObservabilityAddon` and `ManagedClusterAddon` for
`local-cluster` as shown in Step 4.

### ArgoCD RBAC error: `is not allowed to: patch resource "multiclusterobservabilities"`

**Fix:** Apply the `ClusterRole`/`ClusterRoleBinding` from Step 3b.
