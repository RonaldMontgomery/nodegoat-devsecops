# EC2 deployment of the signed NodeGoat image (Docker Compose on one host).
#
# - No SSH key and no inbound rules: the host is managed only through SSM.
# - GitHub Actions (production environment on main) can do one thing: send the
#   nodegoat-deploy document, with an image digest, to this one instance.
# - The host verifies the Cosign signature again before running the image and
#   reads its secrets from Secrets Manager at deploy time (tmpfs only).
# - IMDSv2 with a hop limit of 1: containers cannot reach instance credentials.

data "aws_caller_identity" "current" {}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}


locals {
  secret_arn_prefix = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:nodegoat/"
}

# ---------------------------------------------------------------- network

# A small dedicated VPC (this account has no default VPC in us-east-1): one public
# subnet with an internet gateway for outbound traffic. VPCs, subnets, route tables
# and internet gateways have no hourly charge.
resource "aws_vpc" "app" {
  #checkov:skip=CKV2_AWS_11:Flow logs need a log destination with its own key policy or a CloudWatch log group; out of scope for a single demo host with no inbound rules.
  cidr_block           = "10.42.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "nodegoat"
  }
}

# Take over the VPC's default security group and leave it with no rules.
resource "aws_default_security_group" "app" {
  vpc_id = aws_vpc.app.id
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id
}

resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.42.0.0/26"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "nodegoat-public"
  }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }
}

resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}

resource "aws_security_group" "app" {
  name        = "nodegoat-app"
  description = "NodeGoat host: no inbound access; outbound HTTP(S) only"
  vpc_id      = aws_vpc.app.id

  egress {
    description = "HTTPS: GHCR, Sigstore, SSM, Secrets Manager"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP: Ubuntu package mirrors (packages are signature-checked by apt)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------- host role

resource "aws_iam_role" "app_host" {
  name = "nodegoat-app-host"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "app_host_ssm" {
  role       = aws_iam_role.app_host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "app_host_secrets" {
  name = "read-nodegoat-secrets"
  role = aws_iam_role.app_host.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadOnlyNodeGoatSecrets"
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = "${local.secret_arn_prefix}*"
    }]
  })
}

resource "aws_iam_instance_profile" "app_host" {
  name = "nodegoat-app-host"
  role = aws_iam_role.app_host.name
}

# ---------------------------------------------------------------- host

resource "aws_instance" "app" { # nosemgrep: terraform.aws.security.aws-ec2-has-public-ip.aws-ec2-has-public-ip
  #checkov:skip=CKV_AWS_88:EX-02 in docs/security-exceptions.md. Public IP is for outbound traffic only; the security group allows no inbound traffic.
  #checkov:skip=CKV_AWS_126:Detailed monitoring is a paid add-on; basic monitoring is enough for a demo host.
  ami                         = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app_host.name
  associate_public_ip_address = true
  ebs_optimized               = true

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    cosign_version = var.cosign_version
    cosign_sha256  = var.cosign_sha256
  })
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 16
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name = "nodegoat-app"
  }

  # First boot installs packages, so the route to the internet must exist first.
  depends_on = [aws_route_table_association.app]

  lifecycle {
    # New Ubuntu images are published often; patch in place instead of replacing the host.
    ignore_changes = [ami]
  }
}

# ---------------------------------------------------------------- deploy document

# The only command GitHub may run on the host. The digest is the sole parameter and
# must match the pattern, so it cannot carry shell syntax.
resource "aws_ssm_document" "deploy" {
  name            = "nodegoat-deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy one signed NodeGoat image digest; the host verifies the signature again."
    parameters = {
      digest = {
        type           = "String"
        description    = "Image digest published and signed by container-security.yml on main"
        allowedPattern = "^sha256:[a-f0-9]{64}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand = [
          "set -eu",
          "install -d -m 0755 /opt/nodegoat",
          "echo '${base64encode(file("${path.module}/../docker-compose.yml"))}' | base64 -d > /opt/nodegoat/docker-compose.yml",
          "echo '${base64encode(file("${path.module}/../scripts/deploy-host.sh"))}' | base64 -d > /opt/nodegoat/deploy-host.sh",
          "bash /opt/nodegoat/deploy-host.sh '{{ digest }}'",
        ]
      }
    }]
  })
}

# ---------------------------------------------------------------- GitHub deploy role

resource "aws_iam_role" "github_deploy" {
  name                 = "nodegoat-github-deploy"
  description          = "GitHub Actions production environment of nodegoat-devsecops: run the deploy document on the app host"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = var.github_deploy_subject
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  #checkov:skip=CKV_AWS_356:GetCommandInvocation and DescribeInstanceInformation have no resource-level permissions in IAM.
  name = "send-deploy-document"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunOnlyTheDeployDocumentOnTheAppHost"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = [aws_ssm_document.deploy.arn, aws_instance.app.arn]
      },
      {
        Sid      = "ReadDeployResults"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:DescribeInstanceInformation"]
        Resource = "*"
      },
    ]
  })
}
