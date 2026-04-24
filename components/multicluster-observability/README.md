# Multicluster Observability (ACM)

This component enables ACM multicluster observability on the hub cluster.

## What it applies

- Namespace: `open-cluster-management-observability`
- Secret: `thanos-object-storage` with key `thanos.yaml`
- CR: `MultiClusterObservability/observability`

## Important

Update `base/thanos-object-storage-secret.yaml` with your real object storage values before production use.

If you prefer not to store credentials in Git, replace this Secret with SealedSecret or ExternalSecret in your environment.