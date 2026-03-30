# ACM → ArgoCD Cluster Integration

This component connects **Red Hat Advanced Cluster Management (ACM)** to **OpenShift GitOps (ArgoCD)**, so that every cluster managed by ACM is automatically registered as an ArgoCD destination. Once registered, the `cluster-onboarding` ApplicationSet discovers each cluster's folder in this repo and deploys the correct set of platform services to it.

---

## How It Works

```
ACM (manages clusters)
  └─ GitOpsCluster CR
        └─ creates ArgoCD cluster secrets  ──►  ArgoCD can deploy to spoke clusters
                                                      └─ ApplicationSet discovers clusters/*/
                                                            └─ deploys groups/all + groups/<region>
```

1. **ManagedClusterSetBinding** — Allows the `openshift-gitops` namespace to reference clusters in ACM's `default` ManagedClusterSet.
2. **Placement** — Selects all non-hub managed clusters (anything without the `local-cluster` label).
3. **GitOpsCluster** — Reads the Placement decisions and creates an ArgoCD cluster secret for each selected cluster.
4. **RBAC** — Grants ArgoCD's service account permission to create the `ManagedClusterSetBinding`.

Once ArgoCD has a cluster secret, the `cluster-onboarding` ApplicationSet renders `clusters/<name>/apps/` and creates child Applications that deploy to that cluster.

---

## Prerequisites

Before using this component, the following must already be in place:

| Requirement | Where |
|---|---|
| OpenShift GitOps operator installed | Hub cluster |
| ACM (RHACM) operator installed | Hub cluster |
| Spoke clusters imported into ACM | ACM → Cluster view |
| Clusters assigned to the `default` ManagedClusterSet | ACM → Cluster Sets |
| `cluster-proxy` addon enabled on each spoke | Enabled automatically on import |

To verify cluster membership:

```bash
oc get managedcluster -o custom-columns='NAME:.metadata.name,CLUSTERSET:.metadata.labels.cluster\.open-cluster-management\.io/clusterset,STATUS:.status.conditions[-1].reason'
```

---

## Onboarding a New Cluster

### Step 1 — Confirm the cluster is in ACM

```bash
oc get managedcluster <cluster-name>
```

The cluster should show `ManagedClusterJoined` and `ManagedClusterConditionAvailable`.

### Step 2 — Create the cluster folder in this repo

```
clusters/
└── <cluster-name>/
    └── apps/
        ├── kustomization.yaml
        └── patch-destination-server.yaml
```

**`kustomization.yaml`** — Selects which group bundles apply to this cluster:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: openshift-gitops
namePrefix: <cluster-name>-

resources:
- ../../../groups/all         # Required — every cluster gets this
- ../../../groups/east        # Regional — pick east or west
- ../../../groups/non-prod    # Environment — pick non-prod or prod

patches:
- path: patch-destination-server.yaml
  target:
    group: argoproj.io
    version: v1alpha1
    kind: Application
```

**`patch-destination-server.yaml`** — Sets the ArgoCD destination server for all child Applications.  
Use the ACM cluster-proxy URL, **not** the direct API URL:

```yaml
- op: replace
  path: /spec/destination/server
  value: https://cluster-proxy-addon-user.multicluster-engine.svc.cluster.local:9092/<cluster-name>
```

> **Important:** The `<cluster-name>` at the end of the proxy URL must exactly match the cluster name in ACM (`oc get managedcluster`).

### Step 3 — Commit and push

```bash
git add clusters/<cluster-name>/
git commit -m "feat: onboard <cluster-name>"
git push
```

### Step 4 — ArgoCD auto-discovers the new cluster

The `cluster-onboarding` ApplicationSet watches `clusters/*/` in this repo. Within a few minutes of the push, ArgoCD will:

1. Detect the new folder.
2. Create a `<cluster-name>-cluster-config` Application.
3. Render `clusters/<cluster-name>/apps/` and create all child Applications.

Verify:

```bash
oc get applications.argoproj.io -n openshift-gitops | grep <cluster-name>
```

---

## Group Bundles Reference

Groups are composable sets of ArgoCD Applications. Each cluster folder selects the groups that apply to it.

| Group | Purpose | Who uses it |
|---|---|---|
| `groups/all` | Keycloak OAuth, group sync, compliance, observability | Every cluster |
| `groups/hub` | Keycloak operator, cert-manager, ACM→ArgoCD integration | Hub only |
| `groups/east` | East-region network policies and compliance remediation | East clusters |
| `groups/west` | West-region network policies and compliance remediation | West clusters |
| `groups/non-prod` | Non-production placeholders and overrides | Non-prod clusters |
| `groups/prod` | Production placeholders and overrides | Prod clusters |

---

## Post-Onboarding Steps

Some platform services require secrets or configuration that cannot be stored in Git. These must be applied manually on each new cluster after ArgoCD has synced.

### Keycloak Group Sync credentials

The group sync operator needs Keycloak admin credentials to pull group membership. Apply this secret on the spoke cluster:

```bash
# Switch context to the spoke cluster
oc config use-context <cluster-name>

# Create the secret (replace USERNAME and PASSWORD with Keycloak admin credentials)
oc create secret generic keycloak-group-sync \
  --from-literal=username=<keycloak-admin-user> \
  --from-literal=password=<keycloak-admin-password> \
  -n group-sync-operator
```

Or apply the template file and edit the values:

```bash
oc apply -f components/ocp-keycloak-groupsync-4.20/instances/keycloak-group-sync/00-keycloak-credentials-secret.yaml
```

> The file contains a placeholder password (`change-me`). **Always override it** with the real credential before applying to a production cluster.

### OCP OAuth client secret

ArgoCD deploys the OCP OAuth configuration, but the client secret must exist as a cluster secret before it will work:

```bash
oc create secret generic keycloak-oidc-client-secret \
  --from-literal=clientSecret=<your-client-secret> \
  -n openshift-config
```

Refer to [REALM-SETUP.md](../../components/keycloak-operator/overlays/hub/REALM-SETUP.md) for how to generate and rotate this secret.

---

## Troubleshooting

### ArgoCD shows "cluster not found" on spoke apps

The cluster secret URL doesn't match what's in `patch-destination-server.yaml`.

Check the registered URL:

```bash
oc get secret -n openshift-gitops -l argocd.argoproj.io/secret-type=cluster \
  -o custom-columns='NAME:.metadata.name,SERVER:.data.server' \
  | while read name b64; do echo "$name: $(echo $b64 | base64 -d)"; done
```

The `value:` in `patch-destination-server.yaml` must match exactly.

---

### Placement shows `NoManagedClusterSetBindings`

The `ManagedClusterSetBinding` wasn't created yet. Check the `hub-acm-argocd-integration` Application in ArgoCD and force a sync:

```bash
oc patch applications.argoproj.io hub-acm-argocd-integration \
  -n openshift-gitops --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"syncStrategy":{"apply":{"force":false}}}}}'
```

---

### Spoke apps stuck in `Unknown`

This is normal immediately after cluster registration. ArgoCD needs a moment to test connectivity through the ACM proxy. Force a refresh:

```bash
oc annotate applications.argoproj.io <app-name> \
  -n openshift-gitops \
  argocd.argoproj.io/refresh=hard --overwrite
```

---

### GroupSync CRD not found on first sync

The group sync operator installs via OLM and the `GroupSync` CRD takes ~2 minutes to become available after the Subscription is created. ArgoCD will retry automatically. If it does not recover after 5 minutes, trigger a manual sync:

```bash
oc patch applications.argoproj.io <cluster-name>-keycloak-group-sync \
  -n openshift-gitops --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{"syncStrategy":{"apply":{"force":false}}}}}'
```

---

## Bootstrap (First-Time Hub Setup)

This only needs to be done **once** when setting up a brand new hub cluster. It seeds the `cluster-onboarding` ApplicationSet that drives everything else.

```bash
# Log in to the hub cluster
oc login https://api.<hub-domain>:6443

# Apply the bootstrap ApplicationSet
oc apply -k bootstrap/
```

After this single command, ArgoCD takes over and manages everything from Git.
