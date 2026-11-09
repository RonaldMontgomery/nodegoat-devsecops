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
