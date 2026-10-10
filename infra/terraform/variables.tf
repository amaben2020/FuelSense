# Defaults describe a fresh account. env/prod.tfvars pins the values the
# current account was built with by hand, so importing it changes nothing.

variable "aws_account_id" {
  description = "The only account this state may be applied to."
  type        = string
}

variable "region" {
  type    = string
  default = "eu-north-1"
}

variable "github_repository" {
  description = "owner/name allowed to assume the CI roles."
  type        = string
  default     = "amaben2020/FuelSense"
}

# ---------------------------------------------------------------- compute

variable "availability_zone" {
  description = "AZ for the box. Its default-VPC subnet is used."
  type        = string
  default     = "eu-north-1b"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "ami_id" {
  description = "Pin an AMI. null picks the latest Amazon Linux 2023 at create time; later AMI releases never replace the box."
  type        = string
  default     = null
}

variable "cpu_credits" {
  description = "T3 credit mode. unlimited only costs extra under sustained load, which this box never sees."
  type        = string
  default     = "standard"
}

variable "root_volume_size" {
  type    = number
  default = 16
}

variable "root_volume_encrypted" {
  type    = bool
  default = true
}

variable "ssh_key_name" {
  type    = string
  default = "fuelsense"
}

variable "ssh_public_key" {
  description = "Public half of ~/.ssh/fuelsense.pem (ssh-keygen -y -f ~/.ssh/fuelsense.pem)."
  type        = string
}

variable "ssh_ingress_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "backend_sg_name" {
  type    = string
  default = "fuelsense-backend"
}

variable "backend_sg_description" {
  type    = string
  default = "FuelSense backend: tracker TCP, HTTPS via Caddy, SSH"
}

variable "api_domain" {
  description = "Hostname Caddy gets a certificate for. Its A record must point at the Elastic IP."
  type        = string
  default     = "api.fuelsense.ng"
}

variable "apex_redirect_domain" {
  description = "Bare domain Caddy redirects to www, or null."
  type        = string
  default     = "fuelsense.ng"
}

variable "backend_env_parameter" {
  description = "SSM SecureString holding the backend .env. A new box copies it on first boot; the running box never reads it."
  type        = string
  default     = "/fuelsense/backend/env"
}

# ---------------------------------------------------------------- database

variable "db_identifier" {
  type    = string
  default = "fuelsense-prod"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "Major only, so RDS minor upgrades never show as drift."
  type        = string
  default     = "16"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_max_allocated_storage" {
  type    = number
  default = 100
}

variable "db_backup_retention_days" {
  description = "1 is the Free Tier plan's ceiling."
  type        = number
  default     = 1
}

variable "db_subnet_group_name" {
  description = "Use an existing DB subnet group. null creates one over the default VPC's subnets."
  type        = string
  default     = null
}

variable "db_ca_cert_identifier" {
  type    = string
  default = "rds-ca-rsa2048-g1"
}

# ---------------------------------------------------------------- storage + CDN

variable "frontend_bucket_name" {
  description = "Bucket names are global: a new account needs a new name until the old bucket is deleted."
  type        = string
}

variable "backups_bucket_name" {
  type = string
}

variable "cloudfront_aliases" {
  description = "Custom hostnames, e.g. [\"www.fuelsense.ng\"]. Needs acm_certificate_arn."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "An issued us-east-1 certificate covering cloudfront_aliases."
  type        = string
  default     = null
}

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_All"
}
