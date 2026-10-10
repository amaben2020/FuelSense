# Account 006291942168, built by hand before Terraform existed. These pin the
# values that differ from the module defaults, so the imported resources plan
# as unchanged. A new account copies this file and drops the pins it does not
# need (see infra/README.md).
aws_account_id = "006291942168"
region         = "eu-north-1"

availability_zone     = "eu-north-1b"
ami_id                = "ami-00263659a97a6c29c"
cpu_credits           = "unlimited"
root_volume_size      = 8
root_volume_encrypted = false
ssh_public_key        = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDPpbISDRJ97Iq0u8xJ/bE2q5bpcLGhub86WQUzYe7UpIEujbGRILL581kPKWPIhyWz4w8aCxLu1FCDF+P3RChVE8T7Kdf/vO/CPlUa2AgnbZ07Dld+MQXjvCXRh2HUOTKSudh/7g7tJSIh+Mvxk6F9apVvibpoXVItqr+aJ3wrWly+3Skqi4KBF13Vwpv+UqOblWujgVdhcGzR0KE3D3/L+KLkmzkbxvogrqz6x3t454iSRmR94NoKii5Kbrr+Z59GKEZRdP46hIAxcGn0Obp+1hTDpxgQMLdL6m2aIlB0V3ZJf/RUNZKpbacVWy4BV1DvAvwuByTkSz0A6BkEiLeZ fuelsense"

backend_sg_name        = "launch-wizard-1"
backend_sg_description = "launch-wizard-1 created 2026-06-04T15:51:55.594Z"

db_subnet_group_name = "default"

frontend_bucket_name = "fuelsense-frontend"
backups_bucket_name  = "fuelsense-db-backups"
