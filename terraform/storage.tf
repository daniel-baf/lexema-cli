data "google_compute_default_service_account" "default" {
  project = var.project_id
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_storage_bucket" "sync" {
  name                        = "${var.project_id}-lexema-sync"
  location                    = var.region
  project                     = var.project_id
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "sync_owner_user" {
  bucket = google_storage_bucket.sync.name
  role   = "roles/storage.objectAdmin"
  member = "user:${var.sync_owner_email}"
}

resource "google_storage_bucket_iam_member" "sync_owner_vm" {
  bucket = google_storage_bucket.sync.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${data.google_compute_default_service_account.default.email}"
}
