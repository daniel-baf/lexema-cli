variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "precise-blend-428821-e0"
}

variable "region" {
  description = "Region for the VPC subnet and instance"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zone for the compute instance"
  type        = string
  default     = "us-central1-a"
}

variable "instance_name" {
  description = "Name of the compute instance"
  type        = string
  default     = "lexema-cli"
}

variable "machine_type" {
  description = "Machine type for the compute instance"
  type        = string
  default     = "e2-medium"
}

variable "boot_disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 20
}

variable "boot_disk_type" {
  description = "Boot disk type"
  type        = string
  default     = "pd-balanced"
}

variable "boot_image" {
  description = "Boot image for the instance"
  type        = string
  default     = "debian-cloud/debian-13"
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH (22) into the instance. Restrict this to your own IP/32 when possible."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "app_source_ranges" {
  description = "CIDR ranges allowed to reach the lexema-cli worker (8787)."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "meterpreter_source_ranges" {
  description = "CIDR ranges allowed to reach the meterpreter handler ports (4444-4447). Keep this locked to your own IP for authorized lab use."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "sync_owner_email" {
  description = "GCP account allowed to manage objects in the local<->VM sync bucket."
  type        = string
  default     = "danibaufu@gmail.com"
}
