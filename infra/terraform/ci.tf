# GitHub Actions reaches AWS with short-lived OIDC tokens; no access key is
# stored in GitHub. Three roles, each assumable from a narrower slice of the repo:
#
#   FuelSenseDeployRole        main branch       publish the site, invalidate CloudFront
#   FuelSenseTerraformPlan     PRs + main        read everything, write the state lock
#   FuelSenseTerraformApply    environment       change infrastructure
#                              "production"      (the environment requires approval)

locals {
  # GitHub sends the repository name in the case it was created with, and it
  # has been seen both ways for this repo.
  repo_variants = distinct([var.github_repository, lower(var.github_repository)])
  oidc_host     = "token.actions.githubusercontent.com"
  state_bucket  = "fuelsense-tfstate-${var.aws_account_id}"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://${local.oidc_host}"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ab9d0263244dd0326eb67015705a667e79cfe998"]
}

data "aws_iam_policy_document" "trust_main" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "${local.oidc_host}:sub"
      values   = [for r in local.repo_variants : "repo:${r}:ref:refs/heads/main"]
    }
  }
}

# ---------------------------------------------------------------- site deploy

resource "aws_iam_role" "deploy" {
  name               = "FuelSenseDeployRole"
  description        = "GitHub Actions (main branch only) - publish the static site and invalidate CloudFront"
  assume_role_policy = data.aws_iam_policy_document.trust_main.json
}

resource "aws_iam_role_policy" "deploy_site" {
  name = "FuelSenseSitePublish"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishSiteToBucket"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:PutObjectAcl"]
        Resource = "${aws_s3_bucket.frontend.arn}/*"
      },
      {
        Sid      = "ListBucketForSyncDiffing"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.frontend.arn
      },
      {
        Sid      = "InvalidateThisDistributionOnly"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      },
    ]
  })
}

# ---------------------------------------------------------------- terraform plan

data "aws_iam_policy_document" "trust_plan" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "${local.oidc_host}:sub"
      values = flatten([for r in local.repo_variants : [
        "repo:${r}:ref:refs/heads/main",
        "repo:${r}:pull_request",
      ]])
    }
  }
}

resource "aws_iam_role" "tf_plan" {
  name               = "FuelSenseTerraformPlan"
  description        = "GitHub Actions - terraform plan (read-only, plus the state lock)"
  assume_role_policy = data.aws_iam_policy_document.trust_plan.json
}

resource "aws_iam_role_policy_attachment" "tf_plan_readonly" {
  role       = aws_iam_role.tf_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "state_access" {
  statement {
    sid       = "ListState"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.state_bucket}"]
  }
  statement {
    sid       = "ReadWriteStateAndLock"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${local.state_bucket}/fuelsense/*"]
  }
}

resource "aws_iam_role_policy" "tf_plan_state" {
  name   = "TerraformState"
  role   = aws_iam_role.tf_plan.id
  policy = data.aws_iam_policy_document.state_access.json
}

# ---------------------------------------------------------------- terraform apply

data "aws_iam_policy_document" "trust_apply" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "${local.oidc_host}:sub"
      values   = [for r in local.repo_variants : "repo:${r}:environment:production"]
    }
  }
}

resource "aws_iam_role" "tf_apply" {
  name               = "FuelSenseTerraformApply"
  description        = "GitHub Actions - terraform apply, only from the approved production environment"
  assume_role_policy = data.aws_iam_policy_document.trust_apply.json
}

# PowerUserAccess covers every service here except IAM. IAM is granted
# separately and only over FuelSense's own roles, so an apply cannot mint
# itself (or anything else) broader access.
resource "aws_iam_role_policy_attachment" "tf_apply_poweruser" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

data "aws_iam_policy_document" "tf_apply_iam" {
  statement {
    sid       = "ReadIam"
    actions   = ["iam:Get*", "iam:List*"]
    resources = ["*"]
  }
  statement {
    sid     = "ManageOwnRoles"
    actions = ["iam:*"]
    resources = [
      "arn:aws:iam::${var.aws_account_id}:role/FuelSense*",
      "arn:aws:iam::${var.aws_account_id}:instance-profile/FuelSense*",
      "arn:aws:iam::${var.aws_account_id}:oidc-provider/${local.oidc_host}",
    ]
  }
}

resource "aws_iam_role_policy" "tf_apply_iam" {
  name   = "FuelSenseIam"
  role   = aws_iam_role.tf_apply.id
  policy = data.aws_iam_policy_document.tf_apply_iam.json
}
