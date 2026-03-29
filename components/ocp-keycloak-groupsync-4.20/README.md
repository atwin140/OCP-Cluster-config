# Keycloak Group Sync (OCP 4.20)

This component installs the group-sync operator and a `GroupSync` instance.

## Runtime-only Keycloak CA update (no Git commit)

Use this workflow when you need to trust the Keycloak route certificate in-cluster, but do not want to commit cert material to the repository.

1. Get the Keycloak route host:

```bash
HOST=$(oc get route hub-keycloak -n keycloak -o jsonpath='{.spec.host}')
```

2. Extract the presented certificate chain to a temp file:

```bash
echo | openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  > /tmp/keycloak-ca.crt
```

3. Create or update the `keycloak-certs` ConfigMap directly in the cluster:

```bash
oc create configmap keycloak-certs -n group-sync-operator \
  --from-file=ca.crt=/tmp/keycloak-ca.crt \
  --dry-run=client -o yaml | oc apply -f -
```

4. Verify:

```bash
oc get configmap keycloak-certs -n group-sync-operator -o yaml
```

## Notes

- Keep `instances/keycloak-group-sync/10-keycloak-ca-configmap.yaml` as placeholder content (`CHANGE_ME`) if you do not want certs in Git.
- If your Keycloak certificate is from a public CA already trusted by the cluster, you can remove the `ca` section from the `GroupSync` provider config instead of managing a CA ConfigMap.
