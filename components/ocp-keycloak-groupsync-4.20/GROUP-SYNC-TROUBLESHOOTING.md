# Group Sync Troubleshooting — Fix Applied 2026-04-08

This document records the root causes and exact commands used to bring the
Keycloak group sync from a broken state to a working `ReconcileSuccess`.

---

## Root Causes

| # | Problem | Symptom |
|---|---------|---------|
| 1 | `GroupSync` CR was never applied to the cluster | `oc get groupsync` returned empty |
| 2 | `loginRealm: openshift` — the admin user did not exist in that realm | `401 Invalid user credentials` in operator logs |
| 3 | In-cluster secret had a non-existent Keycloak user (`group-sync-operator`) | Same 401 after applying the CR |
| 4 | `keycloak-certs` ConfigMap had an incomplete TLS chain (missing root CA) | `x509: certificate signed by unknown authority` |

---

## Fix: Step-by-Step Commands

### 1. Diagnose — confirm the GroupSync CR is missing

```bash
oc get groupsync -n group-sync-operator
# Returns empty → CR was never applied
```

### 2. Diagnose — check operator logs for the real error

```bash
oc logs -n group-sync-operator deployment/group-sync-operator-controller-manager \
  -c manager --tail=50
```

### 3. Create a dedicated service account user in the `openshift` realm

Get a token for the Keycloak admin:

```bash
KEYCLOAK_HOST="keycloak.apps.acm.sharkbait.tech"
USER=$(oc get secret hub-keycloak-initial-admin -n keycloak \
  -o jsonpath='{.data.username}' | base64 -d)
PASS=$(oc get secret hub-keycloak-initial-admin -n keycloak \
  -o jsonpath='{.data.password}' | base64 -d)

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
```

Create the `group-sync-sa` user:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "group-sync-sa",
    "enabled": true,
    "firstName": "Group",
    "lastName": "Sync SA",
    "email": "group-sync-sa@local.internal",
    "emailVerified": true,
    "requiredActions": [],
    "credentials": [{"type":"password","value":"<PASSWORD>","temporary":false}]
  }'
# Expect: HTTP 201
```

### 4. Grant the service account read-only realm-management roles

Get role IDs from the `realm-management` client:

```bash
MGMT_CLIENT_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients?clientId=realm-management" \
  | jq -r '.[0].id')

USER_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/users?username=group-sync-sa" \
  | jq -r '.[0].id')
```

Assign `view-users`, `query-groups`, and `query-users` roles:

```bash
for ROLE in view-users query-groups query-users; do
  ROLE_JSON=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
    "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${MGMT_CLIENT_ID}/roles/${ROLE}")

  curl -s -o /dev/null -w "${ROLE}: HTTP %{http_code}\n" \
    -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/users/${USER_ID}/role-mappings/clients/${MGMT_CLIENT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "[${ROLE_JSON}]"
done
# Expect: HTTP 204 for each
```

### 5. Verify the service account can authenticate and list groups

```bash
SA_TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/openshift/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=group-sync-sa&password=<PASSWORD>" \
  | jq -r '.access_token')

curl -s -H "Authorization: Bearer ${SA_TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups" | jq '.[].name'
# Should return: "openshift-access"
```

### 6. Update the in-cluster credentials secret

```bash
oc create secret generic keycloak-group-sync \
  -n group-sync-operator \
  --from-literal=username="group-sync-sa" \
  --from-literal=password="<PASSWORD>" \
  --dry-run=client -o yaml | oc apply -f -
```

### 7. Apply the GroupSync CR

```bash
oc apply -f components/ocp-keycloak-groupsync-4.20/instances/keycloak-group-sync/20-groupsync.yaml
```

### 8. Fix the TLS chain — extract the full cert chain including the root CA

```bash
HOST="keycloak.apps.acm.sharkbait.tech"

# Extract leaf + intermediate from the live route
echo | openssl s_client -showcerts -servername "$HOST" -connect "$HOST:443" 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  > /tmp/keycloak-chain.crt

# Append the ISRG Root X1 (Let's Encrypt trust anchor)
curl -s https://letsencrypt.org/certs/isrgrootx1.pem >> /tmp/keycloak-chain.crt

echo "Certs in chain: $(grep -c 'BEGIN CERTIFICATE' /tmp/keycloak-chain.crt)"
# Should be 3
```

Update the ConfigMap:

```bash
oc create configmap keycloak-certs -n group-sync-operator \
  --from-file=ca.crt=/tmp/keycloak-chain.crt \
  --dry-run=client -o yaml | oc apply -f -
```

### 9. Restart the operator to reload the CA ConfigMap

```bash
oc delete pod -n group-sync-operator \
  $(oc get pod -n group-sync-operator -l control-plane=group-sync-operator \
    -o jsonpath='{.items[0].metadata.name}')
```

### 10. Confirm success

```bash
oc get groupsync keycloak-groupsync -n group-sync-operator \
  -o jsonpath='{.status}' | jq '.'
# Look for: "reason": "LastReconcileCycleSucceded"

oc get groups | grep openshift-access
# Should show the synced group with its members
```

---

## Ongoing Operations

### Re-run the secret update (e.g. after a password rotation)

```bash
oc create secret generic keycloak-group-sync \
  -n group-sync-operator \
  --from-literal=username="group-sync-sa" \
  --from-literal=password="<NEW_PASSWORD>" \
  --dry-run=client -o yaml | oc apply -f -
```

### Refresh the TLS chain (e.g. after cert renewal — every ~90 days for Let's Encrypt)

Re-run steps 8–9 above. The cert currently expires **2026-07-07**.

### Force an immediate sync (instead of waiting for the 15-minute schedule)

```bash
oc annotate groupsync keycloak-groupsync -n group-sync-operator \
  reconcile-now="$(date +%s)" --overwrite
```

---

## Notes

- The `loginRealm` in `20-groupsync.yaml` must match the realm where `group-sync-sa` lives (`openshift`).
- The credentials secret is managed out-of-band (not in Git). The file `00-keycloak-credentials-secret.yaml` keeps a placeholder and must be applied manually before first deploy.
- The CA ConfigMap (`10-keycloak-ca-configmap.yaml`) also keeps a placeholder in Git; update it in-cluster using step 8 above.

---

## Quick-Fix Script — Apply Group Sync to a New Cluster

Run this after switching `KUBECONFIG` to a new cluster. The `group-sync-sa`
user must already exist in Keycloak (one-time setup — see step 3 above).
The script assumes the operator and GroupSync CR are already deployed by GitOps.

Save as `fix-group-sync.sh` or paste directly into your terminal block by block.

```bash
#!/usr/bin/env bash
# fix-group-sync.sh
# Usage: KUBECONFIG=~/.kube/<cluster> bash fix-group-sync.sh
# Requires: oc, openssl, curl, jq

set -euo pipefail

KEYCLOAK_HOST="keycloak.apps.acm.sharkbait.tech"
SA_USER="group-sync-sa"
SA_PASS="Star5454"
NAMESPACE="group-sync-operator"
GROUPSYNC_MANIFEST="components/ocp-keycloak-groupsync-4.20/instances/keycloak-group-sync/20-groupsync.yaml"

echo "==> Target cluster: $(oc whoami --show-server)"
echo ""

# ── 1. Credentials secret ────────────────────────────────────────────────────
echo "==> [1/4] Applying credentials secret..."
oc create secret generic keycloak-group-sync \
  -n "${NAMESPACE}" \
  --from-literal=username="${SA_USER}" \
  --from-literal=password="${SA_PASS}" \
  --dry-run=client -o yaml | oc apply -f -

# ── 2. CA ConfigMap (full 3-cert chain) ──────────────────────────────────────
echo "==> [2/4] Building TLS chain and applying keycloak-certs ConfigMap..."
echo | openssl s_client -showcerts -servername "${KEYCLOAK_HOST}" \
  -connect "${KEYCLOAK_HOST}:443" 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  > /tmp/keycloak-chain.crt
curl -s https://letsencrypt.org/certs/isrgrootx1.pem >> /tmp/keycloak-chain.crt
CERT_COUNT=$(grep -c 'BEGIN CERTIFICATE' /tmp/keycloak-chain.crt)
echo "    Certs in chain: ${CERT_COUNT}"
oc create configmap keycloak-certs \
  -n "${NAMESPACE}" \
  --from-file=ca.crt=/tmp/keycloak-chain.crt \
  --dry-run=client -o yaml | oc apply -f -

# ── 3. GroupSync CR ───────────────────────────────────────────────────────────
echo "==> [3/4] Applying GroupSync CR..."
oc apply -f "${GROUPSYNC_MANIFEST}"

# ── 4. Wait and verify ────────────────────────────────────────────────────────
echo "==> [4/4] Waiting 25s for reconcile..."
sleep 25

STATUS=$(oc get groupsync keycloak-groupsync -n "${NAMESPACE}" \
  -o jsonpath='{.status.conditions[-1].reason}' 2>/dev/null || echo "unknown")

if [[ "${STATUS}" == "LastReconcileCycleSucceded" ]]; then
  echo ""
  echo "SUCCESS: GroupSync reconciled successfully."
else
  echo ""
  echo "WARNING: Last status reason = '${STATUS}'"
  echo "         Check logs: oc logs -n ${NAMESPACE} deploy/group-sync-operator-controller-manager -c manager --tail=30"
  echo "         The group may still be synced — check: oc get groups | grep openshift"
fi

echo ""
echo "Synced groups:"
oc get groups 2>/dev/null | grep openshift || echo "(none found yet)"
```
