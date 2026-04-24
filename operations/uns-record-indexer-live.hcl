variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the indexer image tag"
}

job "uns-record-indexer-live" {
  datacenters = ["ator-fin"]
  type        = "service"
  namespace   = "live-services"

  constraint {
    attribute = "${meta.pool}"
    value     = "live-services"
  }

  group "uns-record-indexer-live-group" {
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
      name = "uns-record-indexer-live"
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

    task "uns-record-indexer-migrations-live-task" {
      driver = "docker"

      lifecycle {
        hook    = "prestart"
        sidecar = false
      }

      config {
        image      = "ghcr.io/anyone-protocol/uns-record-indexer:${VERSION}"
        command    = "node"
        args       = ["dist/migrate.js"]
      }

      env {
        VERSION  = var.commit_sha
        NODE_ENV = "production"
        DB_NAME  = "uns_indexer"
      }

      template {
        data = <<-EOH
        {{- range service "uns-record-indexer-postgres-live" }}
        DB_HOST="{{ .Address }}"
        DB_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "local/db.env"
        env         = true
      }

      template {
        data = <<-EOH
        {{ with secret "kv/live-services/uns-record-indexer-live" }}
        DB_USER="{{ .Data.data.DB_USER }}"
        DB_PASSWORD="{{ .Data.data.DB_PASS }}"
        DB_READ_USER="{{ .Data.data.DB_READ_USER }}"
        DB_READ_PASSWORD="{{ .Data.data.DB_READ_PASS }}"
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

    task "uns-record-indexer-live-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/uns-record-indexer:${VERSION}"
      }

      env {
        VERSION                  = var.commit_sha
        NODE_ENV                 = "production"
        PORT                     = "3000"
        DB_NAME                  = "uns_indexer"
        UNS_CONTRACT_ADDRESS     = "0xF6c1b83977DE3dEffC476f5048A0a84d3375d498"
        START_BLOCK              = "32615764"
        BLOCK_CONFIRMATIONS      = "12"
        WATCHED_UNS_KEY          = "token.ANYONE.ANYONE.ANYONE.address"
        REQUIRED_VALUE_SUFFIX    = ".anyone"
        HEALING_INTERVAL_MS      = "3600000"
        HEALING_BLOCK_CHUNK_SIZE = "100000"
        HEALING_CHUNK_DELAY_MS   = "1000"
        METADATA_FETCH_MAX_ATTEMPTS        = "4"
        METADATA_FETCH_BASE_DELAY_MS       = "500"
        METADATA_FETCH_TIMEOUT_MS          = "5000"
        METADATA_BACKFILL_INTERVAL_MS      = "600000"
        METADATA_BACKFILL_BATCH_SIZE       = "25"
        METADATA_BACKFILL_REQUEST_DELAY_MS = "200"
        RPC_FAILOVER_COOLDOWN_MS     = "600000"
        RPC_FAILOVER_HEAL_BACK_ENABLED = "false"
        RPC_FAILOVER_ERROR_THRESHOLD = "3"
        UNS_TOKEN_HEALING_INTERVAL_MS="86400000"
        UNS_TOKEN_HEALING_BLOCK_CHUNK_SIZE="10000"
        UNS_TOKEN_HEALING_CHUNK_DELAY_MS="1000"
      }

      template {
        data = <<-EOH
        {{- range service "uns-record-indexer-postgres-live" }}
        DB_HOST="{{ .Address }}"
        DB_PORT="{{ .Port }}"
        {{- end }}
        EOH
        destination = "local/db.env"
        env         = true
      }

      template {
        data = <<-EOH
        {{ with secret "kv/live-services/uns-record-indexer-live" }}
        INFURA_HTTP_RPC_URL="https://base-mainnet.infura.io/v3/{{ .Data.data.INFURA_API_KEY_2 }}"
        INFURA_WS_RPC_URL="wss://base-mainnet.infura.io/ws/v3/{{ .Data.data.INFURA_API_KEY_2 }}"
        ALCHEMY_HTTP_RPC_URL="https://base-mainnet.g.alchemy.com/v2/{{ .Data.data.ALCHEMY_API_KEY_2 }}"
        ALCHEMY_WS_RPC_URL="wss://base-mainnet.g.alchemy.com/v2/{{ .Data.data.ALCHEMY_API_KEY_2 }}"
        DB_USER="{{ .Data.data.DB_USER }}"
        DB_PASSWORD="{{ .Data.data.DB_PASS }}"
        DB_READ_USER="{{ .Data.data.DB_READ_USER }}"
        DB_READ_PASSWORD="{{ .Data.data.DB_READ_PASS }}"
        {{ end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      consul {}

      vault { role = "any1-nomad-workloads-controller" }

      resources {
        cpu    = 1024
        memory = 1024
      }
    }
  }
}
