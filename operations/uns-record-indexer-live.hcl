job "uns-record-indexer-live" {
  datacenters = ["ator-fin"]
  type        = "service"
  namespace   = "live-services"

  constraint {
    attribute = "${meta.pool}"
    value     = "live"
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

    task "uns-record-indexer-live-task" {
      driver = "docker"

      config {
        image      = "ghcr.io/anyone-protocol/uns-record-indexer:DEPLOY_TAG"
        force_pull = true
      }

      env {
        VERSION                  = "DEPLOY_TAG"
        NODE_ENV                 = "production"
        PORT                     = "3000"
        DB_USER                  = "postgres"
        DB_NAME                  = "uns_indexer"
        UNS_CONTRACT_ADDRESS     = "0xF6c1b83977DE3dEffC476f5048A0a84d3375d498"
        START_BLOCK              = "44737800"
        BLOCK_CONFIRMATIONS      = "12"
        WATCHED_UNS_KEY          = "token.ANYONE.ANYONE.ANYONE.address"
        REQUIRED_VALUE_SUFFIX    = ".anyone"
        HEALING_INTERVAL_MS      = "300000"
        HEALING_BLOCK_CHUNK_SIZE = "100000"
        HEALING_CHUNK_DELAY_MS   = "1000"
        RPC_FAILOVER_COOLDOWN_MS     = "600000"
        RPC_FAILOVER_ERROR_THRESHOLD = "3"
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
        INFURA_HTTP_RPC_URL="https://base-mainnet.infura.io/v3/{{ .Data.data.INFURA_API_KEY }}"
        INFURA_WS_RPC_URL="wss://base-mainnet.infura.io/ws/v3/{{ .Data.data.INFURA_API_KEY }}"
        ALCHEMY_HTTP_RPC_URL="https://base-mainnet.g.alchemy.com/v2/{{ .Data.data.ALCHEMY_API_KEY }}"
        ALCHEMY_WS_RPC_URL="wss://base-mainnet.g.alchemy.com/v2/{{ .Data.data.ALCHEMY_API_KEY }}"
        DB_PASSWORD="{{ .Data.data.DB_PASSWORD }}"
        {{ end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }

      consul {}

      vault {
        role = "any1-nomad-workloads-controller"
      }

      service {
        name = "uns-record-indexer-live"
        tags = ["logging"]
      }

      resources {
        cpu    = 256
        memory = 512
      }
    }
  }
}
