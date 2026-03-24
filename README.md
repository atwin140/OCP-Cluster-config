# OCP Cluster Config — Compliance Operator STIG Scanning

GitOps repository managing OpenShift Compliance Operator STIG scanning via
**OpenShift GitOps (Argo CD)** using the **app-of-apps** pattern and **Kustomize**.

---

## Repository Tree

```
.
├── apps/
│   ├── kustomization.yaml              # Kustomize root for all Argo CD objects
│   ├── app-of-apps.yaml               # Bootstrap Application (apply once manually)
│   ├── compliance-app-project.yaml    # Argo CD AppProject (wave 0)
│   ├── east-compliance-scanning.yaml  # Argo CD Application → east cluster (wave 1)
│   └── west-compliance-scanning.yaml  # Argo CD Application → west cluster (wave 1)
│
├── base/
│   └── compliance-scanning/
│       ├── kustomization.yaml         # Base Kustomize manifest
│       ├── scan-setting.yaml          # ScanSetting (wave 1 inside overlay sync)
│       └── scan-setting-binding.yaml  # ScanSettingBinding (wave 2)
│
└── overlays/
    ├── east/
    │   ├── kustomization.yaml         # East overlay – patches + cluster annotations
    │   └── patch-scan-setting.yaml    # Schedule 01:00 UTC, storageClass gp3-csi
    └── west/
        ├── kustomization.yaml         # West overlay – patches + cluster annotations
        └── patch-scan-setting.yaml    # Schedule 07:00 UTC, storageClass standard-csi
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| OpenShift Container Platform | 4.12 or later |
| Compliance Operator | Installed and healthy in `openshift-compliance` |
| OpenShift GitOps | Argo CD running in `openshift-gitops` |
| Clusters registered | East and west clusters added to Argo CD |
| Profiles available | `ocp4-stig` and `rhcos4-stig` shipped by the operator |

---

## Quick Start

### 1. Replace placeholder values

Search for `REPLACE_ME` across the `apps/` directory and substitute:

| Placeholder | Replace with |
|---|---|
| `https://github.com/REPLACE_ME/OCP-Cluster-config.git` | Your actual Git remote URL |
| `https://east-cluster-api.example.com:6443` | East cluster API endpoint (from `oc cluster-info`) |
| `https://west-cluster-api.example.com:6443` | West cluster API endpoint |

Storage class names in the overlay patches (`gp3-csi`, `standard-csi`) should
also match what is available on each cluster:

```bash
oc get storageclass          # run on each cluster
```

### 2. Bootstrap Argo CD (run once on hub cluster)

```bash
oc apply -f apps/app-of-apps.yaml
```

Argo CD will sync `apps/` → create the `AppProject` → create both cluster
`Application` objects → sync each overlay to its target cluster.

### 3. Verify

See the **Post-Deployment Verification** section below.

---

## Scan Configuration

| Setting | Value | Rationale |
|---|---|---|
| `autoApplyRemediations` | `false` | All fixes go through Git review |
| `autoUpdateRemediations` | `false` | Prevents silent remediation updates |
| `strictNodeScan` | `true` | Fails loudly if node enumeration is incomplete |
| `roles` | `master`, `worker` | Covers all node types |
| `schedule` (east) | `0 1 * * *` | 01:00 UTC – off-peak for US East |
| `schedule` (west) | `0 7 * * *` | 07:00 UTC – midnight Pacific |
| `rawResultStorage.rotation` | `3` | Retain last 3 result sets |
| `rawResultStorage.size` | `1Gi` | Per-node PVC |
| `scanTolerations` | master `NoSchedule` | Ensures scan pods reach control-plane |

### Profiles

| Profile | Scope |
|---|---|
| `ocp4-stig` | OCP4 API / control-plane STIG checks |
| `rhcos4-stig` | RHCOS4 node-level STIG checks (master + worker) |

---

## Sync Wave Order

```
app-of-apps sync (hub cluster)
  wave 0  →  AppProject (compliance-app-project.yaml)
  wave 1  →  east-compliance-scanning Application
  wave 1  →  west-compliance-scanning Application

Per-cluster sync (inside each Application)
  wave 1  →  ScanSetting
  wave 2  →  ScanSettingBinding   ← triggers ComplianceSuite creation
```

---

## Post-Deployment Verification

Run all commands in the target cluster's context unless noted.

```bash
# 1. Confirm Argo CD Applications are Synced/Healthy
oc get applications -n openshift-gitops

# 2. Confirm ScanSetting was created
oc get scansetting stig-scan-setting -n openshift-compliance -o yaml

# 3. Confirm ScanSettingBinding was created
oc get scansettingbinding stig-binding -n openshift-compliance -o yaml

# 4. Watch the ComplianceSuite appear (operator creates it from the binding)
oc get compliancesuite -n openshift-compliance -w

# 5. Watch individual ComplianceScan progress
oc get compliancescans -n openshift-compliance

# 6. Check scan pod status on each node
oc get pods -n openshift-compliance -l workload=scanner

# 7. View ComplianceCheckResult summary once scans complete
oc get compliancecheckresults -n openshift-compliance \
  --sort-by='.status.severity' | head -40

# 8. Count results by status
oc get compliancecheckresults -n openshift-compliance \
  -o jsonpath='{range .items[*]}{.status.result}{"\n"}{end}' | sort | uniq -c

# 9. List generated remediations (none applied yet)
oc get complianceremediations -n openshift-compliance

# 10. Verify raw result PVCs were created
oc get pvc -n openshift-compliance
```

---

## Controlled Remediation Workflow (GitOps-safe)

Remediations are **never applied automatically**. The recommended workflow:

### Step 1 – Review available remediations
```bash
oc get complianceremediations -n openshift-compliance \
  -o custom-columns=NAME:.metadata.name,APPLY:.spec.apply,SEVERITY:.metadata.annotations."compliance\.openshift\.io/rule"
```

### Step 2 – Export a remediation to Git
```bash
REMEDIATION=<remediation-name>
oc get complianceremediation $REMEDIATION -n openshift-compliance -o yaml \
  | grep -v 'creationTimestamp\|resourceVersion\|uid\|generation\|managedFields' \
  > base/compliance-scanning/remediations/${REMEDIATION}.yaml
```

### Step 3 – Add to kustomization, open a PR, get peer review, merge.

### Step 4 – Apply via patch (or let Argo CD apply the exported manifest)
```bash
oc patch complianceremediation $REMEDIATION -n openshift-compliance \
  --type=merge -p '{"spec":{"apply":true}}'
```

### Step 5 – Trigger a re-scan to confirm compliance
```bash
oc annotate compliancescan ocp4-stig -n openshift-compliance \
  compliance.openshift.io/rescan=
```

---

## Extending This Structure

| Task | How |
|---|---|
| Add a third cluster | Copy `overlays/east/` → `overlays/<name>/`, add an Application in `apps/` |
| Add another profile (e.g. `ocp4-cis`) | Add a `profiles` entry in `base/compliance-scanning/scan-setting-binding.yaml` |
| Change scan schedule | Edit the relevant `overlays/<cluster>/patch-scan-setting.yaml` |
| Pin to a specific operator version | Add a `targetRevision` git tag to the Application |
| Suspend scanning temporarily | Patch `spec.suspend: true` in `scan-setting.yaml` via overlay |

# OCP-Cluster-config
