# Keycloak Realm Setup — Hub Cluster

This guide walks through the full process of (re-)creating the `openshift` Keycloak realm, wiring it to OpenShift OAuth, and validating the login flow.

Follow this any time you need to start fresh (e.g., PKCE config change, secret rotation, broken realm import).

---

## Prerequisites

- `oc` logged in as `cluster-admin` on the hub cluster
- `curl` and `jq` available locally
- ArgoCD is running and has synced the base Keycloak operator app

---

## Step 0 — Export environment variables

Run these once at the start of the session. Every later step references them.

```bash
export APPS_DOMAIN=$(oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}')
export KEYCLOAK_HOST="keycloak.${APPS_DOMAIN}"
export REDIRECT_URI="https://oauth-openshift.${APPS_DOMAIN}/oauth2callback/keycloak"

echo "Keycloak : https://${KEYCLOAK_HOST}"
echo "Redirect : ${REDIRECT_URI}"
```

---

## Step 1 — Get a Keycloak admin token

```bash
ADMIN_PASS=$(oc get secret hub-keycloak-initial-admin \
  -n keycloak -o jsonpath='{.data.password}' | base64 -d)

TOKEN=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=admin&password=${ADMIN_PASS}" \
  | jq -r '.access_token')

# Verify — should print a long JWT string, not "null"
echo "${TOKEN}" | cut -c1-40
```

> **Token lifetime is short (~60 s).** If later steps return 401, re-run this block.

---

## Step 2 — Tear down the existing realm (if it exists)

### 2a. Delete the Kubernetes CR

The `KeycloakRealmImport` operator only runs its import **once** when the CR is first created. Updating the CR in-place does **not** re-trigger the import. You must delete and recreate it.

```bash
oc delete keycloakrealmimport hub-keycloak-realm-openshift -n keycloak --ignore-not-found
```

Wait for deletion:

```bash
oc get keycloakrealmimport -n keycloak
# Should show "No resources found"
```

### 2b. Delete the realm in Keycloak

```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift" \
  -H "Authorization: Bearer ${TOKEN}"
# Expect: 204
```

A `204` means deleted. A `404` means the realm did not exist — that is fine, continue.

---

## Step 3 — Set the OIDC client secret

The `openshift` client in Keycloak needs a secret that is shared with OpenShift.  
You choose the secret value **before** creating the realm so it can be baked in at import time.

### Option A — Generate a new secret

```bash
export SECRET=$(openssl rand -base64 32)
echo "Client secret: ${SECRET}"
# Save this value — you will need it again if you recreate secrets later
```

### Option B — Use an existing / known value

```bash
export SECRET='paste-your-secret-here'
```

---

## Step 4 — Patch the realm import YAML with the real secret

The file [keycloak-realm-openshift.yaml](keycloak-realm-openshift.yaml) contains `secret: "CHANGE_ME"` as a placeholder.  
Replace it with your chosen secret before committing/applying:

```bash
sed -i '' "s/secret: \"CHANGE_ME\"/secret: \"${SECRET}\"/" \
  components/keycloak-operator/overlays/hub/keycloak-realm-openshift.yaml
```

Verify:

```bash
grep 'secret:' components/keycloak-operator/overlays/hub/keycloak-realm-openshift.yaml
# Should show your real secret value, not CHANGE_ME
```

> **Do not commit the secret value to Git.** After confirming that the import worked (Step 8), revert the file back to `CHANGE_ME` before pushing:
>
> ```bash
> sed -i '' "s/secret: \"${SECRET}\"/secret: \"CHANGE_ME\"/" \
>   components/keycloak-operator/overlays/hub/keycloak-realm-openshift.yaml
> ```

---

## Step 5 — Create runtime secrets in the cluster

These secrets are **never stored in Git**. Recreate them any time they are lost or rotated.

### 5a. Keycloak realm config secret (used by `hub-realm-config` overlay)

```bash
oc create secret generic hub-keycloak-realm-config \
  -n keycloak \
  --from-literal=clientSecret="${SECRET}" \
  --from-literal=redirectUri="${REDIRECT_URI}" \
  --from-literal=webOrigin='+' \
  --dry-run=client -o yaml | oc apply -f -
```

### 5b. OpenShift OAuth OIDC secret

```bash
oc create secret generic keycloak-oidc-client-secret \
  -n openshift-config \
  --from-literal=clientSecret="${SECRET}" \
  --dry-run=client -o yaml | oc apply -f -
```

Both secrets must hold the **same** `clientSecret` value.

---

## Step 6 — Apply the realm import

ArgoCD will recreate the `KeycloakRealmImport` CR on its next sync, triggering a fresh import.  
Force a sync now:

```bash
# Option A — via ArgoCD CLI
argocd app sync keycloak-operator --force

# Option B — trigger via oc (ArgoCD server URL depends on your environment)
# patch the app annotation to request a refresh, then sync from UI
```

Alternatively, apply the kustomize overlay directly to force immediate creation:

```bash
oc apply -k components/keycloak-operator/overlays/hub/
```

---

## Step 7 — Monitor the realm import

```bash
# Watch status
oc get keycloakrealmimport hub-keycloak-realm-openshift -n keycloak -w

# Detailed conditions
oc describe keycloakrealmimport hub-keycloak-realm-openshift -n keycloak \
  | grep -A 10 "Conditions:"
```

Expected when complete:

```
Type:    Done
Status:  True
```

If `Done: False` with a message, the import failed — see [Troubleshooting](#troubleshooting) below.

---

## Step 8 — Verify the realm and client

### 8a. Confirm the realm exists

```bash
# Refresh TOKEN if needed (see Step 1)
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift" \
  | jq '{realm, enabled}'
# Expect: { "realm": "openshift", "enabled": true }
```

### 8b. Confirm the `openshift` client was created correctly

```bash
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq '.[] | select(.clientId=="openshift") | {clientId, redirectUris, publicClient, standardFlowEnabled, secret}'
```

Expected output:

```json
{
  "clientId": "openshift",
  "redirectUris": ["https://oauth-openshift.<your-domain>/oauth2callback/keycloak"],
  "publicClient": false,
  "standardFlowEnabled": true
}
```

- `publicClient` must be `false` (confidential client)
- `redirectUris` must match your actual OpenShift redirect URI (`$REDIRECT_URI`)
- `secret` field should be present (not empty)

---

## Step 8c — Manually create or repair the client (if the import failed)

If the realm import completed but the `openshift` client is missing or wrong, use the
Keycloak Admin UI or API to create it manually.

### Via the Keycloak Admin UI

1. Open `https://${KEYCLOAK_HOST}` → log in as `admin`
2. Switch to the **`openshift`** realm (top-left dropdown)
3. Go to **Clients** → **Create client**
4. Fill in:
   - **Client type**: OpenID Connect
   - **Client ID**: `openshift`
   - Click **Next**
5. On the **Capability config** screen:
   - Enable **Client authentication** (makes it a confidential client)
   - Leave **Standard flow** enabled
   - Disable everything else (Direct access grants, Implicit flow, etc.)
   - Click **Next**
6. On the **Login settings** screen:
   - **Valid redirect URIs**: `https://oauth-openshift.<your-apps-domain>/oauth2callback/keycloak`
   - **Web origins**: `+`
   - Click **Save**
7. Go to the **Credentials** tab:
   - Copy the **Client secret** — this is your `$SECRET` value
   - Or click **Regenerate** to create a new one, then update the cluster secrets (Step 5)

> **Important**: Do NOT enable PKCE (`Advanced` tab → `Proof Key for Code Exchange`).
> OpenShift OAuth does not support PKCE and the login will fail with `Invalid redirect_uri`.

### Via the Keycloak API

```bash
# Create the client
curl -s -X POST \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
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
    \"redirectUris\": [\"${REDIRECT_URI}\"],
    \"webOrigins\": [\"+\"]
  }"
# Expect: HTTP 201 Created

# Confirm it was created
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq '.[] | select(.clientId=="openshift") | {clientId, redirectUris, publicClient}'
```

### 8d. Add the `groups` client scope (required for group sync)

The realm import also creates a `groups` scope with the group membership mapper. If you
created the client manually or the scope is missing:

```bash
# Create the groups scope
SCOPE_ID=$(curl -s -X POST \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "groups",
    "description": "OpenShift group membership",
    "protocol": "openid-connect",
    "attributes": {"include.in.token.scope": "true"}
  }' -w "\n%{http_code}" | tail -1)

# Get the scope ID
SCOPE_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes" \
  | jq -r '.[] | select(.name=="groups") | .id')

# Add the group membership mapper to it
curl -s -X POST \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/client-scopes/${SCOPE_ID}/protocol-mappers/models" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "groups",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-group-membership-mapper",
    "config": {
      "full.path": "true",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true",
      "claim.name": "groups"
    }
  }'

# Assign the scope to the openshift client
CLIENT_ID=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq -r '.[] | select(.clientId=="openshift") | .id')

curl -s -X PUT \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients/${CLIENT_ID}/optional-client-scopes/${SCOPE_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
# Expect: HTTP 204
```

---

## Step 9 — Verify the realm and client via Keycloak API (summary check)

```bash
# Confirm openshift client config (quick summary)
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq '.[] | select(.clientId=="openshift") | {clientId, redirectUris, publicClient, standardFlowEnabled}'
```

Expected `redirectUris` value: `["https://oauth-openshift.<your-domain>/oauth2callback/keycloak"]`  
`publicClient` must be `false`.

---

## Step 10 — Verify OCP login

1. Open a private/incognito browser tab.
2. Navigate to the OpenShift console: `https://console-openshift-console.${APPS_DOMAIN}`
3. Click the `keycloak` identity provider button.
4. You should be redirected to the Keycloak login page for realm `openshift`.
5. Log in with a user from the realm. After consent you should land on the OCP console.

If login still fails, check:

```bash
# OAuth server pod logs (look for redirect_uri or client_not_found errors)
oc logs -n openshift-authentication deployment/oauth-openshift --tail=50

# Check the OAuth cluster config is correct
oc get oauth cluster -o yaml
```

---

## Step 11 — Clean up the patched YAML

After confirming login works, revert the secret placeholder so it is not accidentally committed:

```bash
sed -i '' "s/secret: \"${SECRET}\"/secret: \"CHANGE_ME\"/" \
  components/keycloak-operator/overlays/hub/keycloak-realm-openshift.yaml

git diff components/keycloak-operator/overlays/hub/keycloak-realm-openshift.yaml
# Should show only the secret line reverting to CHANGE_ME, nothing else
```

Then commit and push all other changes using your normal GitOps workflow.

---

## Troubleshooting

### `Done: False` on the realm import

Check the CR events and operator logs:

```bash
oc describe keycloakrealmimport hub-keycloak-realm-openshift -n keycloak
oc logs -n keycloak deployment/keycloak-operator --tail=100 | grep -i "realm\|error\|import"
```

Common causes:
- `secret: "CHANGE_ME"` was not replaced before apply → redo Step 4 and Step 6
- Keycloak pod not ready yet → wait and retry
- Realm already exists → redo Step 2b to delete it first
- Import succeeded but client is wrong → see Step 8c to repair manually

### `Client not found` error in browser

The realm import may have succeeded but the client config is wrong. Verify via the Keycloak API (Step 8) and check that `clientId: openshift` exists.

### `Invalid redirect_uri` error in browser

The `redirectUris` in the client does not match what OpenShift sent. Compare:

```bash
# What OpenShift sends as redirect_uri:
echo "https://oauth-openshift.${APPS_DOMAIN}/oauth2callback/keycloak"

# What is configured in Keycloak client:
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${KEYCLOAK_HOST}/admin/realms/openshift/clients" \
  | jq '.[] | select(.clientId=="openshift") | .redirectUris'
```

If they differ, update [keycloak-realm-openshift.yaml](keycloak-realm-openshift.yaml) and redo Steps 2–9.

### `invalid_grant` in GroupSync

The GroupSync service account credentials may be wrong or in the wrong realm. See the GroupSync component README at [components/ocp-keycloak-groupsync-4.20/README.md](../../../ocp-keycloak-groupsync-4.20/README.md).

---

## Rotating the client secret later

1. Export the new value: `export SECRET='new-value'`
2. Regenerate in Keycloak UI: `Clients → openshift → Credentials → Regenerate`
3. Update cluster secrets (Step 5) — **no realm delete needed for a secret rotation**
4. Restart the OpenShift OAuth server to pick up the new secret:

   ```bash
   oc rollout restart deployment/oauth-openshift -n openshift-authentication
   ```
