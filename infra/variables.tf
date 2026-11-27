variable "aws_region" {
  description = "AWS region for course resources."
  type        = string
  default     = "us-east-1"
}

variable "project_tag" {
  description = "Value of the required Project tag (enforced by infra/policy.rego)."
  type        = string
  default     = "DevSecOps-NodeGoat"
}

variable "noncurrent_version_days" {
  description = "Days to keep noncurrent object versions of pipeline evidence."
  type        = number
  default     = 30
}

variable "instance_type" {
  description = "EC2 size for the Compose host (2 GB RAM fits MongoDB and the app with their 512M limits)."
  type        = string
  default     = "t3.small"
}

variable "cosign_version" {
  description = "Cosign release installed on the host (same as the pipeline's)."
  type        = string
  default     = "v3.1.4"
}

variable "cosign_sha256" {
  description = "SHA-256 of cosign-linux-amd64 for cosign_version, from the release's cosign_checksums.txt."
  type        = string
  default     = "424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa"

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.cosign_sha256))
    error_message = "cosign_sha256 must be a 64-character lowercase hex SHA-256."
  }
}

variable "github_deploy_subject" {
  description = "OIDC subject allowed to assume the deploy role: this repository's production environment."
  type        = string
  default     = "repo:RonaldMontgomery@25271540/nodegoat-devsecops@1450775371:environment:production"
}
