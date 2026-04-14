# OpenShift Kustomize Patch Walkthrough

## Overview

This document explains how Kustomize patches are being used to manage OpenShift ingress configuration in a clean, maintainable, and GitOps-friendly way.

The objective is to help experienced administrators who may be newer to OpenShift understand:

* how patches work
* how patches differ from full resource definitions
* how the repository is structured
* how Kustomize and Argo CD work together to apply these changes

In this approach, the base `Kustomization` contains the common remediation resources that should be applied across clusters.

Instead of managing the ingress controller as a full standalone manifest in the base, we apply targeted changes by using `patches:`. This keeps the base simpler and makes it easier to add platform-specific customization later.

---

## How It Works

The `default` OpenShift ingress controller already exists in the cluster.

We are not creating a second ingress controller, and we are not replacing the full object definition. Instead, Kustomize applies a patch that updates only the fields defined in the patch file.

### Flow

```text
Git Repository
   |
   |-- kustomization.yaml
   |-- remediations/
       |-- ocp4-cis-ocp-allowed-registries.yaml
       |-- ocp4-cis-scc-limit-container-allowed-capabilities.yaml
       |-- ocp4-cis-configure-network-policies-namespaces.yaml
       |-- ocp4-cis-ingress-controller-tls-cipher-suites.yaml
       |-- ingress-aws-patch.yaml
   |
   v
Kustomize Build
   |
   |-- Loads base resources
   |-- Applies listed patches
   |
   v
Rendered Output
   |
   |-- Existing IngressController is updated with only the patched fields
   |
   v
Argo CD Sync
   |
   v
OpenShift Cluster
```

### Patch Behavior

```text
Existing OpenShift Object:
IngressController/default
namespace: openshift-ingress-operator

Before patch:
spec:
  tlsSecurityProfile:
    type: OldValueOrDefault
  endpointPublishingStrategy:
    ...
  replicas:
    ...
  nodePlacement:
    ...

Patch file:
spec:
  tlsSecurityProfile:
    type: Intermediate

After patch:
spec:
  tlsSecurityProfile:
    type: Intermediate
  endpointPublishingStrategy:
    ...
  replicas:
    ...
  nodePlacement:
    ...
```

Only the fields defined in the patch are updated. All other settings remain in place unless they are also included in a patch.

### Patch vs Full Replacement

```text
PATCH BEHAVIOR
--------------
Original object
  + selected fields from patch
= updated object

Only the matching fields are changed.


FULL REPLACEMENT BEHAVIOR
-------------------------
Original object
  replaced by
New full manifest
= complete object definition must be managed
```

This implementation uses the patch model, not full replacement.

---

## Files

### Repository Layout

```text
kustomization.yaml
remediations/
├── ocp4-cis-ocp-allowed-registries.yaml
├── ocp4-cis-scc-limit-container-allowed-capabilities.yaml
├── ocp4-cis-configure-network-policies-namespaces.yaml
├── ocp4-cis-ingress-controller-tls-cipher-suites.yaml
└── ingress-aws-patch.yaml
```

### File Roles

* `kustomization.yaml`

  * Defines the base resources and the patches to apply.
* `remediations/ocp4-cis-ocp-allowed-registries.yaml`

  * Standard remediation manifest deployed as a resource.
* `remediations/ocp4-cis-scc-limit-container-allowed-capabilities.yaml`

  * Standard remediation manifest deployed as a resource.
* `remediations/ocp4-cis-configure-network-policies-namespaces.yaml`

  * Standard remediation manifest deployed as a resource.
* `remediations/ocp4-cis-ingress-controller-tls-cipher-suites.yaml`

  * Patch that updates the default ingress controller TLS configuration.
* `remediations/ingress-aws-patch.yaml`

  * Placeholder patch for future AWS-specific ingress settings.

### Resource and Patch Relationship

```text
kustomization.yaml
   |
   |-- resources:
   |     |-- ocp4-cis-ocp-allowed-registries.yaml
   |     |-- ocp4-cis-scc-limit-container-allowed-capabilities.yaml
   |     |-- ocp4-cis-configure-network-policies-namespaces.yaml
   |
   |-- patches:
         |-- ocp4-cis-ingress-controller-tls-cipher-suites.yaml
         |-- ingress-aws-patch.yaml
```

Files listed under `resources:` are rendered as manifests.

Files listed under `patches:` are applied as targeted updates to matching existing objects.

---

## Examples

### Example `kustomization.yaml`

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- remediations/ocp4-cis-ocp-allowed-registries.yaml
- remediations/ocp4-cis-scc-limit-container-allowed-capabilities.yaml
- remediations/ocp4-cis-configure-network-policies-namespaces.yaml

patches:
- path: remediations/ocp4-cis-ingress-controller-tls-cipher-suites.yaml
- path: remediations/ingress-aws-patch.yaml

commonLabels:
  app.kubernetes.io/part-of: compliance-remediation
  app.kubernetes.io/managed-by: argocd
```

### Example Ingress TLS Patch

This patch updates the existing default ingress controller and sets the desired TLS security profile.

```yaml
apiVersion: operator.openshift.io/v1
kind: IngressController
metadata:
  name: default
  namespace: openshift-ingress-operator
  annotations:
    argocd.argoproj.io/sync-wave: "1"
spec:
  tlsSecurityProfile:
    type: Intermediate
```

### Example AWS Placeholder Patch

This patch is a placeholder for future AWS-specific ingress customization.

```yaml
apiVersion: operator.openshift.io/v1
kind: IngressController
metadata:
  name: default
  namespace: openshift-ingress-operator
spec:
  # Placeholder for future AWS-specific ingress settings
  # Example:
  # endpointPublishingStrategy:
  #   type: LoadBalancerService
  #   loadBalancer:
  #     providerParameters:
  #       type: AWS
  #       aws:
  #         type: NLB
```

---

## Summary

```text
resources: = objects we want to deploy as manifests
patches:   = changes we want to apply to existing matching objects
```

We are using `patches:` here because the OpenShift ingress controller already exists and we only want to change selected settings on it, not replace it with a full new definition.
