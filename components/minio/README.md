# MinIO for ACM Multicluster Observability

This component deploys MinIO on the hub cluster and configures the `thanos-object-storage` secret used by ACM MultiClusterObservability.

## What it creates

- Namespace `open-cluster-management-observability`
- PersistentVolumeClaim `minio-data`
- Deployment `minio`
- Service `minio`
- Route `minio-console`
- Secret `minio-credentials`
- Secret `thanos-object-storage`
- Job `minio-create-observability-bucket`

## Defaults

- Bucket: `observability-thanos`
- Internal endpoint: `minio.open-cluster-management-observability.svc.cluster.local:9000`
- Hub storage class: `synology-nfs-storage-pro`

## Required follow-up

Replace the placeholder credentials in `base/minio-credentials-secret.yaml` and `base/thanos-object-storage-secret.yaml` before production use.