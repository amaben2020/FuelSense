# Every AWS account has a default VPC in every region, so the stack uses it
# instead of building one: there is no NAT gateway to pay for, and a new account
# needs no networking decisions.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_subnet" "backend" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

# CloudFront's origin-facing ranges. :5001 is open to these only, so /api/*
# reaches the app through CloudFront while the port stays closed to everyone else.
data "aws_ec2_managed_prefix_lists" "cloudfront" {
  filter {
    name   = "prefix-list-name"
    values = ["com.amazonaws.global.cloudfront.origin-facing"]
  }
}

resource "aws_security_group" "backend" {
  name        = var.backend_sg_name
  description = var.backend_sg_description
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "FMC150 TCP INGESTION"
    from_port   = 5027
    to_port     = 5027
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "API ENDPOINT"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_ingress_cidrs
  }

  ingress {
    from_port       = 5001
    to_port         = 5001
    protocol        = "tcp"
    prefix_list_ids = data.aws_ec2_managed_prefix_lists.cloudfront.ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "FUELSENSE BACKEND SG"
  }
}

resource "aws_security_group" "db" {
  name        = "fuelsense-rds-sg"
  description = "Postgres 5432 from the FuelSense EC2 backend only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "FuelSense backend EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "fuelsense-rds-sg"
    Project = "FuelSense"
  }
}
