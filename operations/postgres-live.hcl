job "uns-record-indexer-postgres-live" {
  datacenters = ["ator-fin"]
  type        = "service"
  namespace   = "live-services"

  constraint {
    attribute = "${meta.pool}"
    value     = "live"
  }

  group "uns-record-indexer-postgres-live-group" {
    count = 1

    update {
      max_parallel     = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
      auto_revert      = true
    }

    network {
      mode = "bridge"
      port "db-port" {
        host_network = "wireguard"
        to           = 5432
      }
    }

    volume "uns-record-indexer-postgres-live" {
      type      = "host"
      read_only = false
      source    = "uns-record-indexer-postgres-live"
    }

    service {
      name = "uns-record-indexer-postgres-live"
      port = "db-port"
      tags = ["logging"]

      check {
        name         = "Postgres TCP check"
        type         = "tcp"
        port         = "db-port"
        interval     = "10s"
        timeout      = "10s"
        address_mode = "alloc"

        check_restart {
          limit = 5
          grace = "60s"
        }
      }
    }

    task "uns-record-indexer-postgres-live-task" {
      driver = "docker"

      config {
        image      = "postgres:16-alpine"
        force_pull = false
      }

      volume_mount {
        volume      = "uns-record-indexer-postgres-live"
        destination = "/var/lib/postgresql/data"
        read_only   = false
      }

      env {
        POSTGRES_DB   = "uns_indexer"
        POSTGRES_USER = "postgres"
      }

      template {
        data = <<-EOH
        {{ with secret "kv/live-services/uns-record-indexer-live" }}
        POSTGRES_PASSWORD="{{ .Data.data.DB_PASSWORD }}"
        {{ end }}
        EOH
        destination = "secrets/db.env"
        env         = true
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

      identity {
        name = "vault_default"
        aud  = ["any1-infra"]
        ttl  = "1h"
      }

      resources {
        cpu    = 256
        memory = 512
      }
    }
  }
}
