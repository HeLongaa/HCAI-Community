path "provider-secrets/delete/hcai/production/providers/*" {
  capabilities = ["update"]
}

path "provider-secrets/destroy/hcai/production/providers/*" {
  capabilities = ["update"]
}

path "provider-secrets/metadata/hcai/production/providers/*" {
  capabilities = ["read"]
}

path "auth/token/lookup-self" {
  capabilities = ["read"]
}
