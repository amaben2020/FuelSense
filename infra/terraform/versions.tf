terraform {
  # 1.10 for S3-native state locking (use_lockfile); no DynamoDB table needed.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Bucket and region come from env/<account>.backend.hcl, so moving accounts
  # never means editing this file:
  #   terraform init -backend-config=env/prod.backend.hcl
  backend "s3" {
    key          = "fuelsense/prod.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  # A guard against applying with the wrong profile: the plan fails instead
  # of creating a second copy of production in some other account.
  allowed_account_ids = [var.aws_account_id]
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
