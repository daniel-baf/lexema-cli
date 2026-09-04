output "instance_name" {
  value = google_compute_instance.lexema_cli.name
}

output "external_ip" {
  value = google_compute_instance.lexema_cli.network_interface[0].access_config[0].nat_ip
}

output "ssh_command" {
  value = "gcloud compute ssh ${google_compute_instance.lexema_cli.name} --zone=${var.zone} --project=${var.project_id}"
}

output "sync_bucket" {
  value = google_storage_bucket.sync.name
}
