# Moving FuelSense to a new AWS account

Plan for moving production off AWS account `006291942168` (IAM user `amaben`,
region `eu-north-1`). Inventory taken 2026-10-03 from the live account. Since
2026-10-10 the stack is in Terraform (`infra/`), which replaces the manual
build in §3.

The tracker reaches the server through DNS (`tcp.fuelsense.ng`). The
dashboard reaches it through `api.fuelsense.ng` and CloudFront. So cutover
is mostly **build in parallel, copy the database, change four DNS records**.
The FMC150 keeps every record in flash until the server ACKs it, so while
it can't reach any server during cutover it buffers. When it reconnects it
uploads the backlog. No position data is lost, as long as the old server is
stopped (not still ACKing into a database you have already copied).

---

## 1. What exists today

### FuelSense production (must move)

| Resource | Identifier | Notes |
| --- | --- | --- |
| EC2 (API + tracker TCP) | `i-02365bd7ac603ace3`, t3.micro, tag `fuelsense` | Amazon Linux, Node 18, 8 GB root (69% used). Runs `fuelsense.service` (the app), `caddy.service`, and a **retired** `postgresql.service` that can be dropped |
| Elastic IP | `13.63.114.126` (`eipalloc-080c7513d03e83dca`) | **Cannot move between accounts.** New account = new IP |
| Security group | `sg-06c0501032767e6a1` | 22, 80, 443, 5027 open to the world; 5001 closed (Caddy proxies to it) |
| Key pair | `fuelsense` (`~/.ssh/fuelsense.pem`) | Import the same public key into the new account, or make a new one and update the `EC2_SSH_KEY` secret |
| RDS | `fuelsense-prod`, db.t4g.micro, Postgres 16.15, 20 GB, encrypted, private | Database `fuelsense`. Backup retention 1 day (Free Tier cap) |
| RDS manual snapshot | `fuelsense-post-migration-20260821` | Old; does not need to move |
| S3 | `fuelsense-frontend` | Static Next export, served by CloudFront |
| S3 | `fuelsense-db-backups` | Nightly `pg_dump` from `fuelsense-db-backup.timer` on the box (`backend/ops/`) |
| CloudFront | `EMLYMQX2321Z2` (`dtz4lvqdpmzcy.cloudfront.net`) | Origins: `s3-site` → frontend bucket, `ec2-api` → EC2 public DNS for `/api/*`. Serves `www.fuelsense.ng` |
| ACM cert (us-east-1) | `www.fuelsense.ng` | For CloudFront. Must be re-issued in the new account |
| IAM role | `FuelSenseDeployRole` | Assumed by GitHub Actions via OIDC to deploy the frontend |
| IAM OIDC provider | `token.actions.githubusercontent.com` | Required by the role above |
| IAM role | `FuelSenseBackendRole` | Instance role on the EC2 box for writing backups to S3 |

### FuelSense demo (decide: move or drop)

| Resource | Identifier |
| --- | --- |
| EC2 | `i-0b1701794473627a2`, t3.small, `fuelsense-demo`, **stopped** |
| Security group | `sg-077c629b9483de51b` |
| CloudFront | `EHNBVG9SKAEE3` (`d39oimvfu8yxcd.cloudfront.net`) |

Everything is scripted in `ops/demo-ec2/` (`up.sh`, `deploy.sh`,
`cloudfront.sh`, `down.sh`), so re-creating it in the new account is a
fresh `up.sh` rather than a copy. Its database lives on the box and is
seeded (`npm run demo:seed`), so there is nothing to carry over.

### In this account but not FuelSense (out of scope — decide separately)

- ~~RDS `database-1` (Aurora PostgreSQL 17 serverless)~~: deleted 2026-10-10. It never had a connection. Final snapshot `database-1-final-20261010`.
- S3 `amaben-bucket-007` and CloudFront `E2ANJK3IRJG515` in front of it
- S3 `notif-system-tfstate`, `soower-landing-media`

### Not on AWS (unchanged by the move)

- DNS for `fuelsense.ng` at **DomainKing** (nameservers `dan1/dan2.host-ww.net`). Route 53 is not used.
- Upstash Redis, Google Maps key, SendGrid, OCR.space: all keys live in the box `.env`
- Netlify site `fuelsenseapp` (locked; `fuelsense.ng` currently resolves there, see §6)
- GitHub repo `amaben2020/FuelSense` and its Actions secrets

### Current DNS

| Record | Points to | Used by |
| --- | --- | --- |
| `tcp.fuelsense.ng` A | `13.63.114.126` | The FMC150 tracker (port 5027). TTL 3600 |
| `api.fuelsense.ng` A | `13.63.114.126` | Caddy, Let's Encrypt cert, proxies to :5001 |
| `www.fuelsense.ng` | CloudFront `dtz4lvqdpmzcy.cloudfront.net` | The dashboard |
| `fuelsense.ng` A | `75.2.60.5` (Netlify) | The Caddyfile expects this to point at the box and redirect to `www` |

---

## 2. Before you start

1. **New account ready:** an admin IAM user (not root) with an access key in
   a separate AWS CLI profile, e.g. `aws configure --profile fs-new`. Pick
   the region now; staying in `eu-north-1` means nothing in the code
   changes. Ask for the account to be off the Free Tier plan if you want RDS
   backup retention above 1 day.
2. **Lower DNS TTLs at DomainKing a day ahead:** set `tcp`, `api` and `www`
   to 300 s. The tracker then follows the change within minutes, not an hour.
3. **Take a copy of the box `.env`** (never commit it):
   `scp -i ~/.ssh/fuelsense.pem ec2-user@13.63.114.126:backend/.env ~/fuelsense-prod.env`
   Keys in it: `PORT TCP_PORT DATABASE_URL NODE_ENV JWT_SECRET JWT_EXPIRES_IN
   FUEL_PRICE_NGN_LITER OCR_SPACE_API_KEY UPSTASH_REDIS_REST_URL
   UPSTASH_REDIS_REST_TOKEN GOOGLE_MAPS_API_KEY GOOGLE_API_DAILY_CAP
   GOOGLE_NEARBY_DAILY_CAP SENDGRID_API_KEY ALERT_EMAIL_OVERRIDE
   ALERT_EMAIL_FROM MAIL_FROM_ADDRESS BACKUP_BUCKET ALLOWED_ORIGINS`.
   Keep `JWT_SECRET` the same so nobody is logged out.
4. **Copy the box config** you will recreate:
   `/etc/systemd/system/fuelsense.service`, `/etc/caddy/Caddyfile`, and the
   backup units (already in `backend/ops/`).
5. **Check the database size** (the step 4 copy time depends on it):
   `SELECT pg_size_pretty(pg_database_size('fuelsense'));`

---

## 3. Build the new stack (no downtime, old one keeps serving)

Terraform builds all of it: the box with its Elastic IP, RDS, both buckets,
CloudFront, IAM and the GitHub OIDC roles. The steps are in
[`infra/README.md`](infra/README.md) under "Moving to a new AWS account". In
short: bootstrap the state bucket, copy `env/prod.*` to `env/new.*`, run
`terraform apply`, put the `.env` in place, then repoint the GitHub variables.

Still by hand: a rehearsal `pg_dump`/`pg_restore` into the new RDS before
cutover day, and the ACM certificate's DNS validation record at DomainKing if
`www` moves to the new distribution.

---

## 4. Cutover (about 15–30 minutes, in a quiet hour)

Tell drivers and managers first: the map freezes for the window, then
catches up. Nothing they record is lost.

1. **Stop the old app:** `ssh old-box 'sudo systemctl stop fuelsense'`. The
   tracker can't connect any more and starts buffering. Nothing is writing
   to the old database now.
2. **Final copy** (from the new box, which can reach both databases through
   a temporary rule letting the new box into the old RDS, or from your
   laptop via two tunnels):
   ```bash
   pg_dump -Fc -d "$OLD_URL" -f fuelsense.dump
   pg_restore --no-owner --clean --if-exists -d "$NEW_URL" fuelsense.dump
   ```
   Check: row counts of `telemetry`, `device_frames`, `fuel_purchases`,
   `alerts` match on both sides, and `MAX(recorded_at)` on `telemetry` is the
   same.
3. **Start the new app:** `sudo systemctl start fuelsense`, and confirm it
   listens on 5027 and 5001.
4. **Flip DNS at DomainKing:** `tcp.fuelsense.ng` and `api.fuelsense.ng` →
   new Elastic IP. Caddy fetches a new `api.fuelsense.ng` certificate on the
   first request after the record resolves (80/443 must be open).
5. **Move `www`:** remove the `www.fuelsense.ng` alias from
   `EMLYMQX2321Z2`, add it to the new distribution, and point the `www`
   record at the new `*.cloudfront.net` name.
6. **Merge the CI change** from 3.6 so the next push deploys to the new
   account.

### Verify
- `journalctl -u fuelsense -f` on the new box shows the FMC150 (IMEI
  `862129084847783`) connecting and a burst of backlog records.
- Dashboard at `https://www.fuelsense.ng`: log in still works (same
  `JWT_SECRET`), live map moves, trips from before the cutover are there,
  Fuel stations page lists the watched stations.
- `curl -I https://api.fuelsense.ng/api/health` → 200 with a valid cert.
- The next morning: a backup object exists in the new bucket, and the 21:00
  WAT daily report went out (`journalctl -u fuelsense | grep daily_report`).

### Rollback
The old box and RDS are only stopped, not touched. Point `tcp` and `api`
back at `13.63.114.126`, put the `www` alias back on `EMLYMQX2321Z2`, and
`systemctl start fuelsense` on the old box. Anything the new server took
in meanwhile would need a dump back the other way, so decide within the
first hour.

---

## 5. After a week of clean running

- Old account: delete the CloudFront distributions, S3 buckets, RDS
  `fuelsense-prod` (take a final snapshot or keep a last `pg_dump` locally
  first), terminate both EC2s, **release the Elastic IP** (an unattached
  EIP bills hourly), delete the IAM roles and OIDC provider.
- Delete the old customer-managed policy `FuelSenseProdRecovery` (detached,
  left from the 2026-09-20 recovery).
- Put DNS TTLs back to 3600.
- Update the docs that hardcode the old IP or account:
  `backend/README-EC2-SIMPLE.md`, `backend/tunnel-watchdog.sh`,
  `ops/observability/obs.sh` (the `prom:prod` tunnel target), and
  `ops/demo-ec2/` if the demo moves.

## 6. Already broken, fix at the same time

`fuelsense.ng` (bare domain) resolves to Netlify (`75.2.60.5`), but the
Caddyfile on the box expects it to point there and redirect to `www`.
While you are changing DNS anyway, point the bare `fuelsense.ng` A record
at the new Elastic IP. Then the frozen Netlify site stops being what people
see when they leave off `www`, and Netlify can be retired.
