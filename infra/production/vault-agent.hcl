pid_file = "/tmp/vault-agent.pid"

vault {
  ca_cert     = "/run/vault-workload/ca.crt"
  client_cert = "/run/vault-workload/client.crt"
  client_key  = "/run/vault-workload/client.key"
}

auto_auth {
  enable_reauth_on_new_credentials = true

  method "cert" {
    mount_path = "auth/cert"
    config = {
      name          = "newchat-secret-lifecycle-gateway"
      ca_cert       = "/run/vault-workload/ca.crt"
      client_cert   = "/run/vault-workload/client.crt"
      client_key    = "/run/vault-workload/client.key"
      reload        = true
      reload_period = "30s"
    }
  }

  sink "file" {
    config = {
      path = "/run/vault-agent/token"
      mode = "0440"
    }
  }
}
