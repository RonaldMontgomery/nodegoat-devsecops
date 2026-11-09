output "evidence_bucket" {
  description = "Name of the pipeline evidence bucket."
  value       = aws_s3_bucket.evidence.bucket
}
