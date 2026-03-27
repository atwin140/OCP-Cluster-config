# OCP Cluster Config - Group-Based OpenShift GitOps

This repository uses a grouped App-of-Apps pattern for OpenShift GitOps.

- A bootstrap ApplicationSet discovers cluster folders under `clusters/`
- Each cluster composes reusable app bundles from `groups/`
- Shared services live in `components/`
- Each cluster patches destination server one time, automatically for all Application objects

## Key Directories

```text
bootstrap/
  kustomization.yaml
  cluster-onboarding-project.yaml
  platform-services-project.yaml
  app-of-apps.yaml

groups/
  all/
  east/
  west/
  prod/
  non-prod/

clusters/
  cluster001/apps/
  cluster002/apps/
  cluster003/apps/
  cluster004/apps/

components/
  compliance-operator/
  remediation/
  observability/
  network-policies/
  placeholders/
```

## Cluster-to-Group Mapping

- cluster001 = all + east + non-prod
- cluster002 = all + east + prod
- cluster003 = all + west + non-prod
- cluster004 = all + west + prod

## Prerequisites

- OpenShift GitOps installed on the hub cluster (`openshift-gitops` namespace)
- Spoke clusters registered in Argo CD
- Cluster-admin or equivalent privileges for bootstrap
- Repo URL and cluster API endpoints available

## 1. Configure Repo Values

1. Replace all `REPLACE_ME` repo URLs with your real Git URL.
2. Update each cluster API endpoint in:
   - `clusters/cluster001/apps/patch-destination-server.yaml`
   - `clusters/cluster002/apps/patch-destination-server.yaml`
   - `clusters/cluster003/apps/patch-destination-server.yaml`
   - `clusters/cluster004/apps/patch-destination-server.yaml`
3. Confirm storage classes used in overlays exist on target clusters.

## 2. Bootstrap Deployment

Run on the hub cluster:

```bash
oc apply -k bootstrap/
```

What this does:

1. Creates AppProjects used by onboarding and platform services
2. Creates the ApplicationSet (`cluster-onboarding`)
3. ApplicationSet discovers `clusters/*`
4. Generates `*-cluster-config` Applications for each cluster folder
5. Each cluster config renders its group composition and creates child service Applications

## 3. Verify Deployment

```bash
# Hub: onboarding and child app CRs
oc get applications -n openshift-gitops
oc get applicationsets -n openshift-gitops

# Spoke: compliance resources
oc get subscription -n openshift-compliance
oc get scansetting -n openshift-compliance
oc get scansettingbinding -n openshift-compliance
oc get compliancesuite -n openshift-compliance
oc get compliancescans -n openshift-compliance
```

## 4. Add a New App (No Per-Cluster Patch Changes)

1. Add the new app manifest to the appropriate group folder (`groups/all`, `groups/east`, etc.)
2. Commit and push

No cluster patch updates are required because each cluster kustomization targets all `Application` objects and patches only `/spec/destination/server`.

## 5. Add a New Cluster

1. Create `clusters/<name>/apps/kustomization.yaml`
2. Select desired group bundles in `resources`
3. Add `patch-destination-server.yaml` with that cluster API endpoint
4. Commit and push

The ApplicationSet will auto-discover the new cluster folder and create `<name>-cluster-config`.

## 6. Example Git Commands

```bash
git add .
git commit -m "refactor: move to group-based app composition and automated cluster destination patching"
git push origin <branch>
```
