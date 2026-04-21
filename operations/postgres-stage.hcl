job "uns-record-indexer-postgres-stage" {
  datacenters = ["ator-fin"]
  type        = "service"
  namespace   = "stage-services"

  constraint {
    attribute = "${meta.pool}"
    value     = "stage"
  }

  group "uns-record-indexer-postgres-stage-group" {
    count = 1

    update {
      max_parallel     = 1
      canary           = 0
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

    volume "uns-record-indexer-postgres-stage" {
      type      = "host"
      read_only = false
      source    = "uns-record-indexer-postgres-stage"
    }

    service {
      name = "uns-record-indexer-postgres-stage"
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

    task "uns-record-indexer-postgres-stage-task" {
      driver = "docker"

      config {
        image      = "postgres:18-alpine"
        force_pull = false
      }

      volume_mount {
        volume      = "uns-record-indexer-postgres-stage"
        destination = "/var/lib/postgresql/data"
        read_only   = false
      }

      env {
        POSTGRES_DB = "uns_indexer"
      }

      template {
        data = <<-EOH
        {{ with secret "kv/stage-services/uns-record-indexer-postgres-stage" }}
        POSTGRES_USER="{{ .Data.data.DB_USER }}"
        POSTGRES_PASSWORD="{{ .Data.data.DB_PASS }}"
        {{ end }}
        EOH
        destination = "secrets/db.env"
        env         = true
      }

      vault { role = "any1-nomad-workloads-controller" }

      consul {}

      resources {
        cpu    = 256
        memory = 512
      }
    }
  }
}
