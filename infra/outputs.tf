output "evidence_bucket" {
  description = "Name of the pipeline evidence bucket."
  value       = aws_s3_bucket.evidence.bucket
}

output "app_instance_id" {
  description = "Set as the DEPLOY_INSTANCE_ID repository variable."
  value       = aws_instance.app.id
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN repository variable."
  value       = aws_iam_role.github_deploy.arn
}

output "deploy_document" {
  description = "SSM document the pipeline sends."
  value       = aws_ssm_document.deploy.name
}
