resource "google_project_service" "compute" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "vpc" {
  name                    = "lexema-cli-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.compute]
}

resource "google_compute_subnetwork" "subnet" {
  name          = "lexema-cli-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_firewall" "allow_ssh" {
  name          = "allow-ssh"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = var.ssh_source_ranges
  target_tags   = ["lexema-cli"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "allow_lexema_app" {
  name          = "allow-lexema-8787"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = var.app_source_ranges
  target_tags   = ["lexema-cli"]

  allow {
    protocol = "tcp"
    ports    = ["8787"]
  }
}

resource "google_compute_firewall" "allow_meterpreter" {
  name          = "allow-meterpreter"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = var.meterpreter_source_ranges
  target_tags   = ["meterpreter"]

  allow {
    protocol = "tcp"
    ports    = ["4444-4447"]
  }
}

resource "google_compute_instance" "lexema_cli" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["lexema-cli", "meterpreter"]

  boot_disk {
    initialize_params {
      image = var.boot_image
      size  = var.boot_disk_size_gb
      type  = var.boot_disk_type
    }
  }

  network_interface {
    network    = google_compute_network.vpc.id
    subnetwork = google_compute_subnetwork.subnet.id

    access_config {
      # Ephemeral external IP.
    }
  }

  metadata = {
    enable-osconfig = "TRUE"
  }

  metadata_startup_script = <<-EOT
    #!/usr/bin/env bash
    set -euo pipefail
    apt-get update -y
    apt-get install -y curl git build-essential apt-transport-https ca-certificates gnupg
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
      apt-get install -y nodejs
    fi
    if ! command -v gcloud >/dev/null 2>&1; then
      echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
        | tee /etc/apt/sources.list.d/google-cloud-sdk.list
      curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
        | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
      apt-get update -y
      apt-get install -y google-cloud-cli
    fi
  EOT

  shielded_instance_config {
    enable_secure_boot          = false
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  service_account {
    scopes = [
      "https://www.googleapis.com/auth/devstorage.read_write",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring.write",
      "https://www.googleapis.com/auth/servicecontrol",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/trace.append",
    ]
  }

  allow_stopping_for_update = true
}
