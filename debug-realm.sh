#!/usr/bin/env bash
# Run each block individually — do NOT run the whole script at once.
# Steps 1-7 are diagnostics. Steps 8-14 create the realm via Admin API directly.
# Use steps 8-14 when the import job shows success but the realm is still missing.

# ── 1. Check import status ────────────────────────────────────────────────────
oc describe keycloakrealmimport hub-keycloak-realm-openshift -n keycloak \
  | grep -A 20 "Conditions:"

# ── 2. List import jobs ───────────────────────────────────────────────────────
oc get jobs -n keycloak

# ── 3. Check import job pod logs ─────────────────────────────────────────────
oc logs -n keycloak -l app=keycloak-realm-import --tail=50

# ── 4. Check secret keys exist ───────────────────────────────────────────────
oc get secret hub-keycloak-realm-config -n keycloak \
  -o jsonpath='{.data}' | jq -r 'keys'

# ── 5. Set environment variables ─────────────────────────────────────────────
export APPS_DOMAIN=$(oc get ingress.config.openshift.io cluster \
  -o jsonpath='{.spec.domain}')
export KEYCLOAK_HOST="keycloak.${APPS_DOMAIN}"
echo "KEYCLOAK_HOST=${KEYCLOAK_HOST}"

# ── 6. Get admin credentials + token ─────────────────────────────────────────
USER=$(oc get secret hub-keycloak-initial-admin \
  -n keycloak -o jsonpath='{.data.username}' | base64 -d)
PASS=$(oc get secret hub-keycloak-initial-admin \
  -n keycloak -o jsonpath='{.data.password}' | base64 -d)

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')

echo "Token (first 40 chars): ${TOKEN:0:40}"

# ── 7. List all realms ────────────────────────────────────────────────────────
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms" | jq '.[].realm'

# ── 8. Check for pod restarts (explains why realm disappeared) ────────────────
oc get pods -n keycloak

# ═════════════════════════════════════════════════════════════════════════════
# DIRECT REALM CREATION VIA ADMIN API
# Run steps 9-14 in order. Re-run step 6 above first to get a fresh TOKEN.
# ═════════════════════════════════════════════════════════════════════════════

# ── 9. Read client secret from the cluster secret ────────────────────────────
export SECRET=$(oc get secret hub-keycloak-realm-config \
  -n keycloak -o jsonpath='{.data.clientSecret}' | base64 -d)
echo "SECRET length: ${#SECRET}"

# ── 10. Create the openshift realm ───────────────────────────────────────────
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"realm":"openshift","displayName":"OpenShift","enabled":true,
       "sslRequired":"external","registrationAllowed":false,
       "bruteForceProtected":true}'
# Expect: HTTP 201 (or 409 if realm already exists — continue either way)

# ── 11. Create the openshift client ──────────────────────────────────────────
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"openshift\",
    \"name\": \"OpenShift\",
    \"description\": \"OpenShift OAuth integration\",
    \"enabled\": true,
    \"protocol\": \"openid-connect\",
    \"publicClient\": false,
    \"secret\": \"${SECRET}\",
    \"standardFlowEnabled\": true,
    \"implicitFlowEnabled\": false,
    \"directAccessGrantsEnabled\": false,
    \"serviceAccountsEnabled\": false,
    \"redirectUris\": [
      \"https://oauth-openshift.apps.acm.sharkbait.tech/oauth2callback/keycloak\",
      \"https://oauth-openshift.apps.cluster01.sharkbait.tech/oauth2callback/keycloak\",
      \"https://oauth-openshift.apps.cluster02.sharkbait.tech/oauth2callback/keycloak\",
      \"https://oauth-openshift.apps.cluster03.sharkbait.tech/oauth2callback/keycloak\",
      \"https://oauth-openshift.apps.cluster04.sharkbait.tech/oauth2callback/keycloak\"
    ],
    \"webOrigins\": [\"+\"]
  }"
# Expect: HTTP 201

# ── 12. Create top-level and child groups ─────────────────────────────────────
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"openshift-access"}'
# Expect: HTTP 201

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
GROUP_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups" \
  | jq -r '.[] | select(.name=="openshift-access") | .id')
echo "openshift-access group ID: ${GROUP_ID}"

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups/${GROUP_ID}/children" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"cluster-admins"}'
# Expect: HTTP 201

# ── 13. Create groups client scope with group membership mapper ───────────────
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"groups","description":"OpenShift group membership",
       "protocol":"openid-connect",
       "attributes":{"include.in.token.scope":"true"}}'
# Expect: HTTP 201

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
SCOPE_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="groups") | .id')
echo "groups scope ID: ${SCOPE_ID}"

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes/${SCOPE_ID}/protocol-mappers/models" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"groups","protocol":"openid-connect",
       "protocolMapper":"oidc-group-membership-mapper",
       "config":{"full.path":"false","id.token.claim":"true",
                 "access.token.claim":"true","userinfo.token.claim":"true",
                 "claim.name":"groups"}}'
# Expect: HTTP 201

# ── 14. Assign scopes to the openshift client ─────────────────────────────────
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
CLIENT_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq -r '.[] | select(.clientId=="openshift") | .id')
echo "openshift client internal ID: ${CLIENT_ID}"

# groups — optional scope
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "groups optional scope: HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_ID}/optional-client-scopes/${SCOPE_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
# Expect: HTTP 204

# email + profile — default scopes (required by OpenShift OAuth)
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
EMAIL_SCOPE=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="email") | .id')
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
PROFILE_SCOPE=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="profile") | .id')
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "email default scope:   HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_ID}/default-client-scopes/${EMAIL_SCOPE}" \
  -H "Authorization: Bearer ${TOKEN}"
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "profile default scope: HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_ID}/default-client-scopes/${PROFILE_SCOPE}" \
  -H "Authorization: Bearer ${TOKEN}"
# Both expect: HTTP 204

# ── 15. Verify realm and client are present ──────────────────────────────────
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
echo "=== Realms ==="
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms" | jq '.[].realm'
echo "=== openshift client ==="
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq '.[] | select(.clientId=="openshift") | {clientId, publicClient, standardFlowEnabled, redirectUris}'

# ═════════════════════════════════════════════════════════════════════════════
# LOGIN FAILURE DIAGNOSTICS
# Run these when OpenShift shows "An authentication error occurred."
# ═════════════════════════════════════════════════════════════════════════════

# ── 16. Refresh env + token (always run this block first) ───────────────────
export APPS_DOMAIN=$(oc get ingress.config.openshift.io cluster \
  -o jsonpath='{.spec.domain}')
export KEYCLOAK_HOST="keycloak.${APPS_DOMAIN}"
USER=$(oc get secret hub-keycloak-initial-admin \
  -n keycloak -o jsonpath='{.data.username}' | base64 -d)
PASS=$(oc get secret hub-keycloak-initial-admin \
  -n keycloak -o jsonpath='{.data.password}' | base64 -d)
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
echo "Token: ${TOKEN:0:40}"

# ── 17. Check client secret matches OpenShift OAuth secret ──────────────────
KC_SECRET=$(oc get secret hub-keycloak-realm-config \
  -n keycloak -o jsonpath='{.data.clientSecret}' | base64 -d)
OCP_SECRET=$(oc get secret keycloak-oidc-client-secret \
  -n openshift-config -o jsonpath='{.data.clientSecret}' | base64 -d)
if [[ "${KC_SECRET}" == "${OCP_SECRET}" ]]; then
  echo "SECRETS MATCH — OK"
else
  echo "SECRETS DO NOT MATCH — this is the login failure cause"
  echo "  Keycloak secret  : ${KC_SECRET:0:8}..."
  echo "  OpenShift secret : ${OCP_SECRET:0:8}..."
fi

# ── 18. Check the actual client secret stored IN Keycloak ───────────────────
CLIENT_UUID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq -r '.[] | select(.clientId=="openshift") | .id')
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/client-secret" \
  | jq '{value}'
# Compare this value with KC_SECRET from step 17

# ── 19. Check oauth-server logs for the actual error ────────────────────────
oc logs -n openshift-authentication \
  -l app=oauth-openshift --tail=30 --since=10m \
  | grep -i "error\|failed\|invalid\|keycloak\|openid"

# ── 20. Check OAuth cluster config is applied ────────────────────────────────
oc get oauth cluster -o jsonpath='{.spec.identityProviders[*].name}' && echo
oc get oauth cluster -o jsonpath='{.spec.identityProviders[0].openID.issuer}' && echo

# ── 21. Check keycloak-oidc-client-secret exists in openshift-config ─────────
oc get secret keycloak-oidc-client-secret -n openshift-config \
  -o jsonpath='{.data}' | jq -r 'keys'
# Must show: ["clientSecret"]

# ── 22. Verify the OIDC discovery endpoint is reachable from the cluster ──────
oc run curl-test --rm -i --restart=Never --image=registry.access.redhat.com/ubi9/ubi-minimal \
  -- curl -sk "https://${KEYCLOAK_HOST}/realms/openshift/.well-known/openid-configuration" \
  | jq '{issuer, authorization_endpoint}'
# issuer must exactly match the value in oauth-cluster.yaml:
#   https://keycloak.apps.acm.sharkbait.tech/realms/openshift

# ── 23. Fix — recreate realm natively to get built-in scopes ─────────────────
# The import-based realm is missing built-in scopes (email, profile).
# Deleting and recreating via the API makes Keycloak auto-populate them.
# Run this entire block as one paste.

export APPS_DOMAIN=$(oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}')
export KEYCLOAK_HOST="keycloak.${APPS_DOMAIN}"
USER=$(oc get secret hub-keycloak-initial-admin -n keycloak -o jsonpath='{.data.username}' | base64 -d)
PASS=$(oc get secret hub-keycloak-initial-admin -n keycloak -o jsonpath='{.data.password}' | base64 -d)
ktoken() { curl -s -X POST "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" | jq -r '.access_token'; }
SECRET=$(oc get secret hub-keycloak-realm-config -n keycloak -o jsonpath='{.data.clientSecret}' | base64 -d)

# Step A — delete the existing realm (clears the broken import)
curl -s -o /dev/null -w "Delete realm: HTTP %{http_code}\n" \
  -X DELETE "https://${KEYCLOAK_HOST}/admin/realms/openshift" \
  -H "Authorization: Bearer $(ktoken)"
# Expect: HTTP 204

# Step B — recreate realm via API (Keycloak auto-creates email, profile, etc.)
curl -s -o /dev/null -w "Create realm: HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms" \
  -H "Authorization: Bearer $(ktoken)" \
  -H "Content-Type: application/json" \
  -d '{"realm":"openshift","displayName":"OpenShift","enabled":true,
       "sslRequired":"external","registrationAllowed":false,"bruteForceProtected":true}'
# Expect: HTTP 201

# Step C — create the openshift OIDC client
curl -s -o /dev/null -w "Create client: HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  -H "Authorization: Bearer $(ktoken)" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":\"openshift\",\"name\":\"OpenShift\",
       \"description\":\"OpenShift OAuth integration\",
       \"enabled\":true,\"protocol\":\"openid-connect\",
       \"publicClient\":false,\"secret\":\"${SECRET}\",
       \"standardFlowEnabled\":true,\"implicitFlowEnabled\":false,
       \"directAccessGrantsEnabled\":false,\"serviceAccountsEnabled\":false,
       \"redirectUris\":[
         \"https://oauth-openshift.apps.acm.sharkbait.tech/oauth2callback/keycloak\",
         \"https://oauth-openshift.apps.cluster01.sharkbait.tech/oauth2callback/keycloak\",
         \"https://oauth-openshift.apps.cluster02.sharkbait.tech/oauth2callback/keycloak\",
         \"https://oauth-openshift.apps.cluster03.sharkbait.tech/oauth2callback/keycloak\",
         \"https://oauth-openshift.apps.cluster04.sharkbait.tech/oauth2callback/keycloak\"
       ],\"webOrigins\":[\"+\"]}"
# Expect: HTTP 201

# Step D — create groups + subgroup
curl -s -o /dev/null -w "Create openshift-access group: HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups" \
  -H "Authorization: Bearer $(ktoken)" \
  -H "Content-Type: application/json" \
  -d '{"name":"openshift-access"}'
# Expect: HTTP 201

GROUP_ID=$(curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups" \
  | jq -r '.[] | select(.name=="openshift-access") | .id')
echo "openshift-access group ID: ${GROUP_ID}"

curl -s -o /dev/null -w "Create cluster-admins subgroup: HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/groups/${GROUP_ID}/children" \
  -H "Authorization: Bearer $(ktoken)" \
  -H "Content-Type: application/json" \
  -d '{"name":"cluster-admins"}'
# Expect: HTTP 201

# Step E — create groups client scope with mapper
curl -s -o /dev/null -w "Create groups scope: HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  -H "Authorization: Bearer $(ktoken)" \
  -H "Content-Type: application/json" \
  -d '{"name":"groups","description":"OpenShift group membership",
       "protocol":"openid-connect","attributes":{"include.in.token.scope":"true"}}'
# Expect: HTTP 201

GROUPS_SCOPE=$(curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="groups") | .id')
echo "groups scope ID: ${GROUPS_SCOPE}"

curl -s -o /dev/null -w "Create groups mapper: HTTP %{http_code}\n" \
  -X POST "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes/${GROUPS_SCOPE}/protocol-mappers/models" \
  -H "Authorization: Bearer $(ktoken)" \
  -H "Content-Type: application/json" \
  -d '{"name":"groups","protocol":"openid-connect",
       "protocolMapper":"oidc-group-membership-mapper",
       "config":{"full.path":"false","id.token.claim":"true",
                 "access.token.claim":"true","userinfo.token.claim":"true",
                 "claim.name":"groups"}}'
# Expect: HTTP 201

# Step F — get client UUID and all scope IDs (email/profile now exist as built-ins)
CLIENT_UUID=$(curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq -r '.[] | select(.clientId=="openshift") | .id')
EMAIL_SCOPE=$(curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="email") | .id')
PROFILE_SCOPE=$(curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="profile") | .id')
echo "CLIENT_UUID  : ${CLIENT_UUID}"
echo "email scope  : ${EMAIL_SCOPE}"
echo "profile scope: ${PROFILE_SCOPE}"
echo "groups scope : ${GROUPS_SCOPE}"
# All four must be non-empty — if any are blank, stop and report

# Step G — assign email + profile as default scopes, groups as optional
curl -s -o /dev/null -w "email default scope:   HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/default-client-scopes/${EMAIL_SCOPE}" \
  -H "Authorization: Bearer $(ktoken)"
curl -s -o /dev/null -w "profile default scope: HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/default-client-scopes/${PROFILE_SCOPE}" \
  -H "Authorization: Bearer $(ktoken)"
curl -s -o /dev/null -w "groups optional scope: HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/optional-client-scopes/${GROUPS_SCOPE}" \
  -H "Authorization: Bearer $(ktoken)"
# All three expect: HTTP 204

# Step H — verify final state
echo "=== All client scopes in realm ==="
curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" | jq '.[].name'
echo "=== openshift client default scopes ==="
curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/default-client-scopes" | jq '.[].name'
echo "=== openshift client optional scopes ==="
curl -s -H "Authorization: Bearer $(ktoken)" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/optional-client-scopes" | jq '.[].name'
# Default scopes must include: "email", "profile"
# Optional scopes must include: "groups"
TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=${USER}&password=${PASS}" \
  | jq -r '.access_token')
curl -s -o /dev/null -w "Update client secret: HTTP %{http_code}\n" \
  -X PUT "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_UUID}/client-secret" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"secret\",\"value\":\"${OCP_SECRET}\"}"
# Expect: HTTP 200
