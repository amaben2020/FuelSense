resource "aws_key_pair" "fuelsense" {
  key_name   = var.ssh_key_name
  public_key = var.ssh_public_key

  lifecycle {
    # AWS never returns the public key, so an imported pair always looks
    # changed and would be replaced. The key itself is created from this value.
    ignore_changes = [public_key]
  }
}

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64"
}

# ---------------------------------------------------------------- instance role

resource "aws_iam_role" "backend" {
  name        = "FuelSenseBackendRole"
  description = "FuelSense backend EC2 instance - writes nightly DB backups to S3"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "backend_backups" {
  name = "FuelSenseBackupWrite"
  role = aws_iam_role.backend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteNightlyBackups"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.backups.arn}/postgres/*"
      },
      {
        Sid       = "ListOwnBackupsForVerification"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.backups.arn
        Condition = { StringLike = { "s3:prefix" = "postgres/*" } }
      },
    ]
  })
}

# Only first boot reads this: user-data copies the .env out of SSM. A separate
# policy so the backup policy above stays exactly as it was.
resource "aws_iam_role_policy" "backend_bootstrap" {
  name = "FuelSenseBootstrapEnv"
  role = aws_iam_role.backend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadBackendEnvOnFirstBoot"
      Effect   = "Allow"
      Action   = "ssm:GetParameter"
      Resource = "arn:aws:ssm:${var.region}:${var.aws_account_id}:parameter${var.backend_env_parameter}"
    }]
  })
}

resource "aws_iam_instance_profile" "backend" {
  name = "FuelSenseBackendProfile"
  role = aws_iam_role.backend.name
}

# ---------------------------------------------------------------- the box

resource "aws_instance" "backend" {
  ami                    = coalesce(var.ami_id, data.aws_ssm_parameter.al2023.insecure_value)
  instance_type          = var.instance_type
  key_name               = aws_key_pair.fuelsense.key_name
  subnet_id              = data.aws_subnet.backend.id
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = aws_iam_instance_profile.backend.name

  user_data = templatefile("${path.module}/files/user-data.sh.tftpl", {
    region               = var.region
    env_parameter        = var.backend_env_parameter
    api_domain           = var.api_domain
    apex_redirect_domain = var.apex_redirect_domain
    fuelsense_unit       = file("${path.module}/../../backend/ops/fuelsense.service")
    caddy_unit           = file("${path.module}/../../backend/ops/caddy.service")
    backup_service       = file("${path.module}/../../backend/ops/fuelsense-db-backup.service")
    backup_timer         = file("${path.module}/../../backend/ops/fuelsense-db-backup.timer")
  })

  credit_specification {
    cpu_credits = var.cpu_credits
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    encrypted             = var.root_volume_encrypted
    delete_on_termination = true
  }

  tags = {
    Name = "fuelsense"
  }

  lifecycle {
    # The box is long-lived and holds state Terraform does not (the .env,
    # Caddy's certificates). A newer AMI or an edited bootstrap script must
    # never replace or reboot it; both only apply to a box built from scratch.
    ignore_changes  = [ami, user_data, user_data_base64]
    prevent_destroy = true
  }
}

# Allocated before anything points at it: the 2026-09-18 outage was an
# auto-assigned address lost on a stop. Addresses cannot move between
# accounts, so a new account gets a new one and DNS follows it.
resource "aws_eip" "backend" {
  domain   = "vpc"
  instance = aws_instance.backend.id

  tags = {
    Name = "fuelsense-prod"
  }

  lifecycle {
    prevent_destroy = true
  }
}
