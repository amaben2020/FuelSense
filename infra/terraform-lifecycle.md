# Terraform lifecycle

How an infrastructure change goes from idea to AWS, and what to do when
something goes off the path. For what is managed and how to move accounts,
see [`README.md`](README.md).

## Why this instead of the console

| Clicking in the console | Terraform + the workflow |
| --- | --- |
| The change lives only in AWS. Nobody knows who did it, when, or why. | The change is a commit with a message and a PR |
| You find out what a click does after it has done it | `plan` shows the exact diff before anything runs |
| A new account means redoing every click from memory | A new account means `terraform apply` with a new tfvars file |
| Mistakes are fixed by more clicking | Revert the commit and apply again |
| A forgotten resource bills quietly (like Aurora did) | Anything not in code shows up as a difference. Anything in code is listed |

It doesn't cover everything. DNS (DomainKing), the backend `.env` secrets and
the data in RDS and S3 stay outside Terraform. Those steps are spelled out in
the README and `MIGRATION.md` instead.

## The normal path

```
 branch ──► PR ──► plan (automatic) ──► review ──► merge ──► plan on main
                                                                  │
                    apply ◄── approve ◄── Run workflow (apply ✔) ◄┘
```

1. **Branch and edit** `infra/terraform/`. Check it locally first if you can:
   ```bash
   cd infra/terraform
   terraform fmt -recursive ..
   terraform init -backend-config=env/prod.backend.hcl
   terraform plan -var-file=env/prod.tfvars
   ```
   A local plan only reads AWS and takes the state lock for a moment. It
   changes nothing.

2. **Open a PR.** The **Terraform** workflow runs `fmt -check`, `validate` and
   `plan`. The job summary lists every resource it would touch, with the full
   plan folded underneath.

3. **Review the plan, not just the code.** See [Reading a plan](#reading-a-plan).
   The question is: is this list exactly what I meant, and nothing more?

4. **Merge.** The workflow plans again against `main`. This plan is the one
   that will be applied, so check it if anything else merged in between.

5. **Apply.** Go to Actions → Terraform → Run workflow, on branch `main`, and
   tick **apply**. The plan job runs, then the apply job waits for approval in
   the `production` environment. Open the plan job's summary, check it, then
   approve. The apply job re-plans and applies.

   Merging alone never applies. A merged but unapplied change shows up as a
   pending diff in every later plan, and the Monday check flags it.

6. **Confirm.** Run the workflow once more without **apply**. It should say
   "No changes. AWS matches the code."

## Reading a plan

| Symbol | Meaning | Usually |
| --- | --- | --- |
| `+` create | New resource | Fine if you added it |
| `~` update in-place | Attribute changes, same resource | Read every changed line |
| `-/+` replace | Destroy, then create a new one | **Stop and check** |
| `-` destroy | Deleted | **Stop and check** |
| `<=` read | Data source lookup | Harmless |

**Never approve:**
- A replace or destroy of `aws_instance.backend`, `aws_db_instance.prod`,
  `aws_eip.backend` or `aws_s3_bucket.backups`. These have `prevent_destroy`,
  so the plan should fail first. If it doesn't, something removed the guard.
- A change to `aws_security_group.backend` that removes port 5027. That cuts
  off the tracker.
- A change to the `ec2-api` origin in `aws_cloudfront_distribution.site`
  that you didn't intend. It is the only path from the dashboard to the API.
- `aws_key_pair` being replaced. It locks out deploys that use `fuelsense.pem`.

**Safe even though they show as updates:** `skip_final_snapshot`,
`final_snapshot_identifier`, `apply_immediately`, `force_destroy`, `tags_all`.
These are Terraform-only settings and make no AWS call.

**Changes that disrupt prod even though they aren't replacements**, so do
them in a quiet hour:
- `instance_type`: AWS stops and starts the box, so the IP stays but the app
  is down for a minute or two.
- `db_instance_class` or storage changes: RDS applies them in the next
  maintenance window (Sunday 03:00 UTC), because `apply_immediately` is off.

## Drift: when AWS and the code disagree

Every Monday at 06:00 UTC the workflow plans with no code change. If AWS was
edited by hand, the plan isn't empty, the job fails, and GitHub emails you.

To fix it, decide which side is right:
- **The console change was a mistake:** run the apply. Terraform puts AWS back.
- **The console change should stay:** change the code to match, open a PR,
  and the plan comes back empty.

Don't leave drift unresolved. The next real apply would quietly undo the
console change.

## Common tasks

**Change a setting** (instance size, retention, a port): edit the variable
in `env/prod.tfvars`, or the resource itself, then follow the normal path.

**Add a resource:** add it to the file that matches (`network.tf`,
`storage.tf`, …). Follow the naming the others use, and add `prevent_destroy`
if losing it would lose data.

**Bring in something created in the console:** add the resource block, plus
a temporary `imports.tf`:
```hcl
import {
  to = aws_s3_bucket.example
  id = "the-bucket-name"
}
```
Plan until it reports `1 to import, 0 to change`. Adjust the code until it
does, rather than accepting changes. Apply, then delete `imports.tf`.

**Stop managing something without deleting it:**
```bash
terraform state rm aws_s3_bucket.example
```
Then remove its block from the code. The resource stays in AWS.

**Change the bootstrap script** (`files/user-data.sh.tftpl`) or
`backend/ops/*.service`: it only affects a box built from scratch. The
running box ignores user-data changes on purpose. Edit the live box over SSH
as well if it needs the same change.

## When something goes wrong

**Apply failed halfway.** Terraform records whatever did finish. Read the
error, fix the code or permissions, and run the apply again. It continues
from where AWS actually is.

**State lock is stuck** ("Error acquiring the state lock"). Make sure no
workflow or laptop run is still going, then remove the lock using the ID in
the error:
```bash
terraform force-unlock <LOCK_ID>
```

**State is damaged or an apply recorded the wrong thing.** The state bucket
is versioned and keeps 90 days of history:
```bash
aws s3api list-object-versions --bucket fuelsense-tfstate-006291942168 \
  --prefix fuelsense/prod.tfstate --query 'Versions[].[VersionId,LastModified]'
```
Restoring an old version only changes what Terraform *believes*. Run a plan
afterwards and check it before applying anything.

**A change broke production.** Revert the commit, merge, and apply. For the
box and database, also check the AWS side. A resized instance can be resized
back, but data written in the meantime stays.

**Emergency fix in the console.** Allowed when prod is down. Afterwards,
bring the code in line (see [Drift](#drift-when-aws-and-the-code-disagree))
the same day, so Monday's check doesn't fail and the next apply doesn't undo it.

## Who can do what

| Action | Where | AWS role |
| --- | --- | --- |
| Plan | PRs, `main`, the weekly check | `FuelSenseTerraformPlan` (read-only, plus the state lock) |
| Apply | Manual run, after approval in `production` | `FuelSenseTerraformApply` (PowerUser, plus IAM on `FuelSense*` only) |
| Local plan or apply | Your laptop | Your own credentials |

PRs from forks get no AWS access, because GitHub doesn't give forks OIDC
tokens. The repository is public, so plan logs are too. Sensitive values are
redacted in them, and saved plans are never uploaded, because a saved plan
includes the generated database password.
