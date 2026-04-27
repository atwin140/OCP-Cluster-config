# Perses Dashboards for ACM Multi-Cluster Observability

This directory contains three Perses-native dashboards that replace the default ACM Grafana dashboards with equivalents compatible with the **Thanos / Perses** observability stack shipped with the OpenShift Cluster Observability Operator.

## Architecture

```
Managed Clusters
   └── MCO Addon (metrics-collector)
         └── Pushes metrics → open-cluster-management-observability (Thanos)
                                 └── rbac-query-proxy (SAR-gated Thanos Querier)
                                       └── PersesDatasource: acm-thanos-querier-datasource
                                             └── Perses UI → PersesDashboard CRDs
```

All dashboards in this directory query **`acm-thanos-querier-datasource`**, which points to the ACM `rbac-query-proxy` service. This proxy applies RBAC/SAR checks so users only see clusters they are authorised to view.

---

## Prerequisites

| Component | Where |
|-----------|-------|
| `MultiClusterObservability` (MCO) | `open-cluster-management-observability` namespace |
| `UIPlugin` (Monitoring) | `openshift-cluster-observability-operator` namespace |
| `PersesDatasource: acm-thanos-querier-datasource` | `openshift-cluster-observability-operator` namespace |
| `Secret: perses-sa-token` | `openshift-cluster-observability-operator` namespace |

Verify they exist before applying the dashboards:

```bash
# Confirm MCO is running
oc get multiclusterobservability observability \
  -n open-cluster-management-observability

# Confirm the Perses datasource exists
oc get persesdatasource acm-thanos-querier-datasource \
  -n openshift-cluster-observability-operator

# Confirm metrics are flowing from at least one managed cluster
oc get pods -n open-cluster-management-observability \
  -l app=thanos-receive
```

---

## The Three Dashboards

### 1. `acm-multicluster-fleet-overview.yaml` — Fleet Overview

**Purpose:** Single-pane-of-glass for the entire fleet. Use this as your
default landing page to assess overall fleet health before drilling deeper.

**Sections:**
| Section | Panels |
|---------|--------|
| Fleet Summary | Active Managed Clusters, Total Nodes (Ready), Total CPU Cores, Total Memory |
| Resource Utilization by Cluster | CPU Usage (time series, per cluster), Memory Usage (time series, per cluster) |
| Pod Health | Running / Failed / Pending counts (stats), Pod Phase over time (time series) |

**Variable:** `cluster` — multi-select, defaults to All. Filters all panels.

**Key queries:**
```promql
# Count active managed clusters
count(acm_managed_cluster_info{available="True"})

# CPU usage per cluster (ACM pre-aggregated metric)
cluster:cpu_usage_cores:sum{cluster=~"$cluster"}

# Memory usage per cluster
cluster:memory_usage:sum{cluster=~"$cluster"}
```

---

### 2. `acm-multicluster-workload-health.yaml` — Workload Health

**Purpose:** Deployment and pod-level health across clusters and namespaces.
Use this for day-2 operations and to investigate application failures.

**Sections:**
| Section | Panels |
|---------|--------|
| Deployment Health | Total / Fully Available / Degraded deployment counts (stats), Deployment replica table |
| Pod Status | Running / Pending / CrashLoopBackOff / OOMKilled (stats), Pod phase by cluster (time series) |
| Container Restarts | Container restart rate per cluster (time series) |

**Variables:**
- `cluster` — multi-select
- `namespace` — single-select, filtered by selected clusters

**Key queries:**
```promql
# Degraded deployments
count(kube_deployment_status_replicas_unavailable{cluster=~"$cluster",namespace=~"$namespace"} > 0)

# CrashLoopBackOff pods
count(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff",cluster=~"$cluster"} == 1)

# Container restart rate
sum by (cluster) (rate(kube_pod_container_status_restarts_total{cluster=~"$cluster"}[5m]))
```

---

### 3. `acm-multicluster-control-plane-etcd.yaml` — Control Plane & etcd Health

**Purpose:** Deep inspection of each cluster's control plane. Use this to
investigate API server latency spikes, etcd pressure, or leader-election
instability before they cause outages.

**Sections:**
| Section | Panels |
|---------|--------|
| API Server Health | Error Rate (5xx), Total Request Rate, Latency p99, Instances Up (stats); Request Rate by Verb, Latency p99 by Resource, Errors by Code (time series) |
| etcd Health | Leader Changes (1h), DB Size, Raft Proposals Failed, gRPC Errors (stats); DB Size over time, WAL fsync p99, gRPC Request Rate by Method (time series) |

**Variable:** `cluster` — single-select (control plane metrics are per-cluster;
selecting multiple would merge etcd pod series from different clusters).

**Key queries:**
```promql
# API server 5xx error rate
sum(rate(apiserver_request_total{cluster="$cluster",code=~"5.."}[5m]))

# API server latency p99 (excluding watches)
histogram_quantile(0.99,
  sum(rate(apiserver_request_duration_seconds_bucket{
    cluster="$cluster", verb!~"WATCH|CONNECT"}[5m])) by (le))

# etcd leader changes in the past hour
increase(etcd_server_leader_changes_seen_total{cluster="$cluster"}[1h])

# etcd WAL fsync latency p99
histogram_quantile(0.99,
  sum by (pod, le) (rate(etcd_disk_wal_fsync_duration_seconds_bucket{
    cluster="$cluster"}[5m])))
```

---

## How to Create a New Perses Dashboard

### Step 1 — Understand the Perses v1alpha2 skeleton

Every `PersesDashboard` has three top-level sections inside `spec.config`:

```yaml
apiVersion: perses.dev/v1alpha2
kind: PersesDashboard
metadata:
  name: my-dashboard
  namespace: openshift-cluster-observability-operator
spec:
  config:
    display:
      name: "Human-Readable Title"
    duration: 1h          # default time range
    variables: [...]      # template variables (cluster, namespace, etc.)
    layouts: [...]        # grid sections that reference panels by $ref
    panels: {}            # keyed map of all panel definitions
```

### Step 2 — Define variables

Variables populate drop-downs in the Perses UI. For multi-cluster dashboards
always start with a `cluster` variable so users can scope their view:

```yaml
variables:
- kind: ListVariable
  spec:
    name: cluster
    display:
      name: Cluster
    allowAllValue: true   # enables the "All" option
    allowMultiple: true   # enables multi-select
    sort: alphabetical-asc
    plugin:
      kind: PrometheusLabelValuesVariable
      spec:
        datasource:
          kind: PersesDatasource
          name: acm-thanos-querier-datasource
        labelName: cluster
        matchers:
        - up{job="kubelet", metrics_path="/metrics/cadvisor"}
```

Add a `namespace` variable that cascades off `$cluster`:

```yaml
- kind: ListVariable
  spec:
    name: namespace
    display:
      name: Namespace
    allowAllValue: true
    allowMultiple: false
    sort: alphabetical-asc
    plugin:
      kind: PrometheusLabelValuesVariable
      spec:
        datasource:
          kind: PersesDatasource
          name: acm-thanos-querier-datasource
        labelName: namespace
        matchers:
        - kube_namespace_labels{cluster=~"$cluster"}
```

### Step 3 — Define panels

Panels are defined in a YAML map under `spec.config.panels`. Keys can be any
string; the convention used here is `section_panelname` (e.g. `fleet_cpu_cores`).

#### Time Series panel (line chart)

```yaml
panels:
  my_cpu_panel:
    kind: Panel
    spec:
      display:
        name: CPU Usage by Cluster
      plugin:
        kind: TimeSeriesChart
        spec:
          legend:
            mode: list
            position: bottom
          visual:
            display: line
            lineWidth: 1.5
          yAxis:
            format:
              unit: decimal   # or bytes, seconds, requests/sec, etc.
      queries:
      - kind: TimeSeriesQuery
        spec:
          plugin:
            kind: PrometheusTimeSeriesQuery
            spec:
              datasource:
                kind: PersesDatasource
                name: acm-thanos-querier-datasource
              query: cluster:cpu_usage_cores:sum{cluster=~"$cluster"}
              seriesNameFormat: '{{cluster}}'
```

#### Stat panel (single big number)

```yaml
  my_stat_panel:
    kind: Panel
    spec:
      display:
        name: Running Pods
      plugin:
        kind: StatChart
        spec:
          calculation: last-number
          format:
            unit: decimal
          thresholds:
            steps:
            - color: green
              value: 0
            - color: red
              value: 1      # threshold at which the colour changes
      queries:
      - kind: TimeSeriesQuery
        spec:
          plugin:
            kind: PrometheusTimeSeriesQuery
            spec:
              datasource:
                kind: PersesDatasource
                name: acm-thanos-querier-datasource
              query: sum(kube_pod_status_phase{phase="Running",cluster=~"$cluster"})
```

#### Table panel

```yaml
  my_table_panel:
    kind: Panel
    spec:
      display:
        name: Deployment Status
      plugin:
        kind: Table
        spec:
          columnSettings:
          - header: Cluster
            name: cluster
            enableSorting: true
          - header: Desired
            name: 'value #desired'
          - header: Available
            name: 'value #available'
          transforms:
          - kind: MergeSeries
            spec: {}
      queries:
      - kind: TimeSeriesQuery
        spec:
          plugin:
            kind: PrometheusTimeSeriesQuery
            spec:
              datasource:
                kind: PersesDatasource
                name: acm-thanos-querier-datasource
              query: kube_deployment_spec_replicas{cluster=~"$cluster"}
              seriesNameFormat: desired
      - kind: TimeSeriesQuery
        spec:
          plugin:
            kind: PrometheusTimeSeriesQuery
            spec:
              datasource:
                kind: PersesDatasource
                name: acm-thanos-querier-datasource
              query: kube_deployment_status_replicas_available{cluster=~"$cluster"}
              seriesNameFormat: available
```

### Step 4 — Arrange panels in a grid layout

Layouts reference panels by JSON pointer (`$ref`). The grid is 24 columns wide.

```yaml
layouts:
- kind: Grid
  spec:
    display:
      title: "Section Title"   # collapsible section header
    items:
    - content:
        $ref: '#/spec/panels/my_cpu_panel'
      x: 0
      "y": 0
      width: 12   # half width
      height: 8
    - content:
        $ref: '#/spec/panels/my_stat_panel'
      x: 12
      "y": 0
      width: 6
      height: 4
```

### Step 5 — Apply via GitOps

Add your new file to the kustomization resources:

```yaml
# components/multicluster-observability/base/kustomization.yaml
resources:
- perses-dashboards/my-new-dashboard.yaml
```

Then either sync via ArgoCD or apply directly:

```bash
# Direct apply (for testing)
oc apply -f perses-dashboards/my-new-dashboard.yaml

# Verify it was accepted
oc get persesdashboard -n openshift-cluster-observability-operator

# Check for backend sync errors
oc get persesdashboard my-new-dashboard \
  -n openshift-cluster-observability-operator \
  -o jsonpath='{.status.conditions}' | python3 -m json.tool
```

### Step 6 — View in the OpenShift Console

1. Log in to the OpenShift Console on the **hub** cluster.
2. Navigate to **Observe → Dashboards**.
3. Your dashboard will appear under the name set in `spec.config.display.name`.
4. Use the **Cluster** drop-down to switch between managed clusters.

---

## Converting an Existing Grafana Dashboard

If you want to port one of the built-in ACM Grafana dashboards (stored as
ConfigMaps in `open-cluster-management-observability`):

```bash
# 1. Export the Grafana JSON
oc get configmap grafana-dashboard-acm-clusters-overview \
  -n open-cluster-management-observability \
  -o jsonpath='{.data}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
key = list(d.keys())[0]
print(d[key])
" > grafana-clusters-overview.json

# 2. Inspect panels and queries
python3 -c "
import json
with open('grafana-clusters-overview.json') as f:
    dash = json.load(f)
for p in dash.get('panels', []):
    if p.get('type') != 'row':
        print(p.get('type'), '|', p.get('title'))
        for t in p.get('targets', []):
            print('  ', t.get('expr','')[:80])
"
```

Map Grafana panel types → Perses panel kinds:

| Grafana type | Perses `plugin.kind` |
|---|---|
| `timeseries` / `graph` | `TimeSeriesChart` |
| `stat` | `StatChart` |
| `gauge` | `GaugeChart` |
| `table` | `Table` |
| `text` | `TextPanel` |

Replace `$datasource` Grafana variable references with the explicit datasource
block shown in Step 3 above. Replace `$__rate_interval` with `5m` or a fixed
interval appropriate for the scrape period (MCO default is 300 s).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Dashboard shows `No data` | Managed cluster metrics not flowing | Check `metrics-collector` pod on managed cluster: `oc logs -n open-cluster-management-addon-observability deployment/metrics-collector-deployment` |
| `PersesBackendError: internal server error 500` | Perses backend cannot reach `rbac-query-proxy` | Verify `perses-sa-token` secret and that `perses-sa` has `get namespaces` ClusterRole |
| Variable drop-down is empty | Datasource reference wrong or no `up` metrics | Confirm `acm-thanos-querier-datasource` exists and the bearer token is valid |
| Dashboard not visible in console | Perses operator hasn't synced | `oc get persesdashboard -n openshift-cluster-observability-operator` and check `.status.conditions` |
