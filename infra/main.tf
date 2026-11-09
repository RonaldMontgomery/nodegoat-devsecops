# Pipeline evidence bucket for NodeGoat (threat T8: keep scan reports, SBOMs and
# provenance traceable to a commit). Same baseline as Lab 7; EC2 host resources
# for the Compose deployment are the next addition.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project = var.project_tag
      Owner   = "RonaldMontgomery"
    }
  }
}

resource "aws_s3_bucket" "evidence" {
  #checkov:skip=CKV_AWS_18:Access logging needs a second log bucket; deferred for a single-user course bucket.
  #checkov:skip=CKV_AWS_144:Cross-region replication is out of scope for course credits; data is reproducible from CI.
  #checkov:skip=CKV2_AWS_62:No consumer for S3 event notifications in this design.
  bucket_prefix = "nodegoat-evidence-"

  tags = {
    Purpose = "pipeline-evidence"
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
