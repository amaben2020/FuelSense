# infra/

Terraform for every AWS resource FuelSense production runs on. Since
2026-10-10 the live account (`006291942168`, `eu-north-1`) is managed by it:
the hand-built resources were imported, and `terraform plan` against them
reports **no changes**.

| Directory | What | State |
| --- | --- | --- |
| `bootstrap/` | The S3 bucket that holds the main stack's state. Run once per account. | Local, disposable |
| `terraform/` | Everything else | `s3://fuelsense-tfstate-<account>/fuelsense/prod.tfstate`, S3-native locking |

## What is in it

| File | Resources |
| --- | --- |
| `network.tf` | Default VPC lookup; backend security group (5027, 80, 443, 22 open; 5001 to CloudFront only); RDS security group (5432 from the backend only) |
| `compute.tf` | Key pair, EC2 box, Elastic IP, `FuelSenseBackendRole` + instance profile |
| `database.tf` | RDS Postgres 16 `fuelsense-prod` |
| `storage.tf` | `fuelsense-frontend` (site) and `fuelsense-db-backups` (nightly dumps) buckets |
| `cdn.tf` | CloudFront distribution (S3 site + `/api/*` to the box), URL-rewrite function, origin access control |
| `ci.tf` | GitHub OIDC provider and the three CI roles |
| `files/user-data.sh.tftpl` | First boot of a new box: Node 18, Caddy, pg16 client, swap, the systemd units from `backend/ops/`, `.env` from SSM |
| `env/prod.*` | The current account's backend config and variables |

**Not in it:** DNS (DomainKing, not Route 53), the backend `.env` and its
secrets, the data in RDS and S3, the stopped `fuelsense-demo` box
(`ops/demo-ec2/`), the Netlify site, and the other projects in this account.

**Protected:** the box, the database, the Elastic IP and the backups bucket
have `prevent_destroy`, so a plan that would replace or delete one fails.
The box ignores AMI and user-data changes, and the database ignores password
and minor-version changes. None of them can be rebuilt by accident.

## Day to day

The full change process (reviewing plans, drift, recovery) is in
[`terraform-lifecycle.md`](terraform-lifecycle.md).


1. Change `infra/terraform/` on a branch and open a PR. The **Terraform**
   workflow plans it and puts the result in the job summary.
2. Merge. It plans again on `main`.
3. To apply: Actions → Terraform → Run workflow → tick **apply**. The apply
   job waits for approval in the `production` environment, re-plans, then
   applies.

A weekly run (Mondays 06:00 UTC) plans with no code change and fails if AWS
was edited by hand. GitHub emails you when it fails.

Locally:

```bash
cd infra/terraform
terraform init -backend-config=env/prod.backend.hcl
terraform plan -var-file=env/prod.tfvars
```

### CI roles (GitHub OIDC, no stored AWS keys)

| Role | Assumable from | Can |
| --- | --- | --- |
| `FuelSenseDeployRole` | `main` | Publish the site bucket, invalidate the distribution |
| `FuelSenseTerraformPlan` | PRs, `main` | Read everything (`ReadOnlyAccess`), write the state lock |
| `FuelSenseTerraformApply` | the `production` environment only | `PowerUserAccess`, plus IAM limited to `FuelSense*` roles |

The workflows read every account-specific value from repository variables
(`gh variable list`), which come from `terraform output github_variables`.
No workflow hardcodes an account id, bucket or distribution.

## Moving to a new AWS account

Build the new stack next to the old one, copy the data, then flip DNS. The
cutover itself (stop old app, final `pg_dump`/`pg_restore`, DNS, verify,
rollback) is in [`MIGRATION.md`](../MIGRATION.md) §4.

1. **Credentials.** Create an admin IAM user in the new account and add a
   profile for it: `aws configure --profile fs-new`. Export
   `AWS_PROFILE=fs-new` for the steps below.

2. **State bucket.**
   ```bash
   cd infra/bootstrap && terraform init && terraform apply
   ```
   This prints `fuelsense-tfstate-<new account id>`. (Its local state file
   can be thrown away.)

3. **Environment files.** Copy `env/prod.backend.hcl` to `env/new.backend.hcl`
   and set `bucket` to that name. Copy `env/prod.tfvars` to `env/new.tfvars`
   and then:
   - set `aws_account_id` to the new account id
   - give both buckets new names, because names are global and the old
     account still holds them: `frontend_bucket_name = "fuelsense-frontend-2"`,
     `backups_bucket_name = "fuelsense-db-backups-2"`
   - delete the lines that only describe how the old account was hand-built:
     `ami_id`, `cpu_credits`, `root_volume_size`, `root_volume_encrypted`,
     `backend_sg_name`, `backend_sg_description` and `db_subnet_group_name`.
     The defaults are what you want: the latest AL2023, a 16 GB encrypted root
     volume, and a dedicated DB subnet group.

4. **Apply from your laptop.** This first apply is local because the CI roles
   don't exist in the new account yet.
   ```bash
   cd infra/terraform
   terraform init -reconfigure -backend-config=env/new.backend.hcl
   terraform plan  -var-file=env/new.tfvars     # expect only creates
   terraform apply -var-file=env/new.tfvars
   ```
   The box boots and installs everything. The database starts empty.

5. **Backend `.env`.** Start from the old box's copy, keeping `JWT_SECRET` so
   nobody is logged out:
   ```bash
   scp -i ~/.ssh/fuelsense.pem ec2-user@13.63.114.126:backend/.env ~/fuelsense-new.env
   terraform output -raw database_url_for_new_instance   # becomes DATABASE_URL
   ```
   In `~/fuelsense-new.env`, set `DATABASE_URL` to that output and
   `BACKUP_BUCKET` to the new backups bucket. Then save it to SSM, so any
   future rebuild picks it up, and copy it to the box:
   ```bash
   aws ssm put-parameter --name /fuelsense/backend/env --type SecureString \
     --value "file://$HOME/fuelsense-new.env" --overwrite
   scp -i ~/.ssh/fuelsense.pem ~/fuelsense-new.env ec2-user@$(terraform output -raw elastic_ip):backend/.env
   rm ~/fuelsense-new.env
   ```

6. **Point GitHub at the new account:**
   ```bash
   gh variable set TF_ENV --body new
   terraform output -json github_variables | jq -r 'to_entries[] | "\(.key) \(.value)"' |
     while read k v; do gh variable set "$k" --body "$v"; done
   gh secret set EC2_HOST --body "$(terraform output -raw elastic_ip)"
   ```
   Then run **Deploy backend to EC2** and **Deploy frontend to CloudFront**
   manually. The backend deploy ships the code, installs dependencies and
   starts the app against the empty database. That's safe: it only runs
   additive migrations.

7. **Rehearse, then cut over.** Do a rehearsal `pg_dump`/`pg_restore` and
   then the real cutover as in `MIGRATION.md` §4. The DNS records to change
   at DomainKing are `tcp` and `api` (to `terraform output elastic_ip`) and
   `www` (to `terraform output cloudfront_domain`, plus `cloudfront_aliases`
   and `acm_certificate_arn` in `env/new.tfvars` once the certificate is
   issued).

8. **Commit** `env/new.*`. Once the old account is retired, delete `env/prod.*`.

Rollback is the old account, untouched until you delete it: point DNS back,
then reset `TF_ENV` and the variables to the `prod` values.
