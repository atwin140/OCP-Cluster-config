# Hub Realm Config Overlay

This overlay lets you manage the `openshift` Keycloak client using a Secret-backed configuration for:

- `clientSecret`
- `redirectUri`
- `webOrigin`

It layers on top of [../hub](../hub/kustomization.yaml) and replaces values in [../hub/keycloak-realm-openshift.yaml](../hub/keycloak-realm-openshift.yaml).

## 0) Get or create the OIDC client secret in Keycloak

Use realm `openshift` and client `openshift`.

### Option A: Find existing secret in Keycloak UI

1. Open Keycloak admin console: `https://keycloak.apps.acm.sharkbait.tech`
2. Select realm: `openshift`
3. Go to `Clients` -> `openshift`
4. Open the `Credentials` tab
5. Copy `Client secret`

### Option B: Regenerate/create secret in Keycloak UI

1. Open `Clients` -> `openshift` -> `Credentials`
2. Click `Regenerate secret`
3. Copy the new `Client secret`
4. Update both OpenShift and realm-config secrets (steps below) with this new value

After you get the value, make sure OpenShift uses the same secret:

```bash
export SECRET='ADD HERE'
oc create secret generic keycloak-oidc-client-secret \
  -n openshift-config \
  --from-literal=clientSecret={$SECRET}  \
  --dry-run=client -o yaml | oc apply -f -
```

## 1) Create or update the config secret

Use this command to create/update `hub-keycloak-realm-config` in the `keycloak` namespace:

```bash
export APPS_DOMAIN=$(oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}')
export URI="https://oauth-openshift.${APPS_DOMAIN}/oauth2callback/keycloak"
echo $URI

oc create secret generic hub-keycloak-realm-config \
  -n keycloak \
  --from-literal=clientSecret={$SECRET}  \
    --from-literal=redirectUri="${URI}" \
  --from-literal=webOrigin='+' \
  --dry-run=client -o yaml | oc apply -f -
```

Notes:

- The `clientSecret` value must match `openshift-config/keycloak-oidc-client-secret` key `clientSecret`.
- If you do not want to commit secret values, create the secret directly in-cluster instead:

```bash
oc create secret generic hub-keycloak-realm-config \
  -n keycloak \
  --from-literal=clientSecret='REPLACE_WITH_OIDC_CLIENT_SECRET' \
  --from-literal=redirectUri='https://oauth-openshift.apps.acm.sharkbait.tech/oauth2callback/keycloak' \
  --from-literal=webOrigin='+' \
  --dry-run=client -o yaml | oc apply -f -
```

## 2) Apply the overlay

```bash
oc apply -k components/keycloak-operator/overlays/hub-realm-config
```

## 3) Verify

```bash
oc get keycloakrealmimport -n keycloak hub-keycloak-realm-openshift -o yaml
```

Confirm under `spec.realm.clients[0]`:

- `clientId: openshift`
- `redirectUris[0]` is your cluster callback URL
- `secret` is populated
