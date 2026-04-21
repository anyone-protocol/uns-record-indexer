job "uns-record-indexer-stage" {
  datacenters = ["ator-fin"]
  type        = "service"
  namespace   = "stage-services"

  constraint {
    attribute = "${meta.pool}"
    value     = "stage"
  }

  group "uns-record-indexer-stage-group" {
    count = 1

    update {
      max_parallel     = 1
      canary           = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
      auto_revert      = true
      auto_promote     = true
    }

    network {
      mode = "bridge"
      port "http-port" {
        host_network = "wireguard"
        to           = 3000
      }
    }

    service {
      name = "uns-record-indexer-stage"
      port = "http-port"
      tags = ["logging"]

      check {
        name         = "UNS record indexer health check"
        type         = "http"
        port         = "http-port"
        path         = "/health"
        interval     = "10s"
        timeout      = "10s"
        address_mode = "alloc"

        check_restart {
          limit = 10
          grace = "30s"
        }
      }
    }

    task "uns-record-indexer-migrations-stage-task" {
      driver = "docker"

      lifecycle {
        hook    = "prestart"
        sidecar = false
      }

      config {
        image      = "ghcr.io/anyone-protocol/uns-record-indexer:${VERSION}"
        force_pull = true
        command    = "node"
        args       = ["dist/migrate.js"]
      }

      env {
        NODE_ENV = "production"
        DB_NAME  = "uns_indexer"
      }

      template {
        data = <<-EOH
        {{- range service "uns-record-indexer-postgres-stage" }}
        DB_HOST="{{ .Address }}"
        DB_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "local/db.env"
        env         = true
      }

      template {
        data = <<-EOH
        {{ with secret "kv/stage-services/uns-record-indexer-stage" }}
        DB_USER="{{ .Data.data.DB_USER }}"
        DB_PASSWORD="{{ .Data.data.DB_PASS }}"
        {{ end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      consul {}
      vault { role = "any1-nomad-workloads-controller" }

      resources {
        cpu    = 128
        memory = 256
      }
    }

    task "uns-record-indexer-stage-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/anyone-protocol/uns-record-indexer:${VERSION}"
        force_pull = true
      }

      env {
        VERSION                  = "[[ .commit_sha ]]"
        NODE_ENV                 = "production"
        PORT                     = "3000"
        DB_NAME                  = "uns_indexer"
        UNS_CONTRACT_ADDRESS     = "0xF6c1b83977DE3dEffC476f5048A0a84d3375d498"
        START_BLOCK              = "32615764"
        BLOCK_CONFIRMATIONS      = "12"
        WATCHED_UNS_KEY          = "token.ANYONE.ANYONE.ANYONE.address"
        REQUIRED_VALUE_SUFFIX    = ".anyone"
        HEALING_INTERVAL_MS      = "300000"
        HEALING_BLOCK_CHUNK_SIZE = "100000"
        HEALING_CHUNK_DELAY_MS   = "1000"
      }

      template {
        data = <<-EOH
        {{- range service "uns-record-indexer-postgres-stage" }}
        DB_HOST="{{ .Address }}"
        DB_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "local/db.env"
        env         = true
      }

      template {
        data = <<-EOH
        {{ with secret "kv/stage-services/uns-record-indexer-stage" }}
        INFURA_HTTP_RPC_URL="https://base-mainnet.infura.io/v3/{{ .Data.data.INFURA_API_KEY_2 }}"
        INFURA_WS_RPC_URL="wss://base-mainnet.infura.io/ws/v3/{{ .Data.data.INFURA_API_KEY_2 }}"
        DB_USER="{{ .Data.data.DB_USER }}"
        DB_PASSWORD="{{ .Data.data.DB_PASS }}"
        {{ end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      consul {}

      vault { role = "any1-nomad-workloads-controller" }

      resources {
        cpu    = 256
        memory = 512
      }
    }
  }
}
