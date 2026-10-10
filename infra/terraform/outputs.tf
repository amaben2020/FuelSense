output "elastic_ip" {
  description = "Point tcp.fuelsense.ng and api.fuelsense.ng here, and set the EC2_HOST secret to it."
  value       = aws_eip.backend.public_ip
}

output "instance_id" {
  value = aws_instance.backend.id
}

output "db_endpoint" {
  value = aws_db_instance.prod.address
}

output "database_url_for_new_instance" {
  description = "DATABASE_URL for an instance Terraform created. Not valid for an imported one, whose password Terraform never set."
  value       = "postgresql://fuelsense:${random_password.db.result}@${aws_db_instance.prod.address}:5432/fuelsense"
  sensitive   = true
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.site.domain_name
}

# The values deploy-frontend.yml and terraform.yml read as repository
# variables. After an account move: gh variable set NAME --body VALUE.
output "github_variables" {
  value = {
    AWS_REGION                 = var.region
    AWS_DEPLOY_ROLE_ARN        = aws_iam_role.deploy.arn
    AWS_TF_PLAN_ROLE_ARN       = aws_iam_role.tf_plan.arn
    AWS_TF_APPLY_ROLE_ARN      = aws_iam_role.tf_apply.arn
    FRONTEND_BUCKET            = aws_s3_bucket.frontend.id
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.site.id
    CLOUDFRONT_DOMAIN          = aws_cloudfront_distribution.site.domain_name
  }
}
