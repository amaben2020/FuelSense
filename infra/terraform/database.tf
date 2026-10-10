resource "aws_db_subnet_group" "this" {
  count      = var.db_subnet_group_name == null ? 1 : 0
  name       = "fuelsense"
  subnet_ids = data.aws_subnets.default.ids
}

# Only used when Terraform creates the instance. On an imported one the
# password is whatever it already was (see ignore_changes); the real value
# lives in the backend .env either way.
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "prod" {
  identifier            = var.db_identifier
  engine                = "postgres"
  engine_version        = var.db_engine_version
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "fuelsense"
  username = "fuelsense"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = coalesce(var.db_subnet_group_name, try(aws_db_subnet_group.this[0].name, null))
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  # default.postgres16 already sets rds.force_ssl=1.
  parameter_group_name = "default.postgres${split(".", var.db_engine_version)[0]}"
  ca_cert_identifier   = var.db_ca_cert_identifier

  backup_retention_period    = var.db_backup_retention_days
  backup_window              = "02:00-03:00"
  maintenance_window         = "sun:03:00-sun:04:00"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.db_identifier}-final"

  tags = {
    Project = "FuelSense"
  }

  lifecycle {
    # engine_version: RDS applies minor upgrades itself (16.15 today), and
    # sending the bare major back would be read as a version change.
    ignore_changes  = [password, engine_version]
    prevent_destroy = true
  }
}
