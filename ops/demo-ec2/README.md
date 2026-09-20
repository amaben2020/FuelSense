# demo-ec2 — the disposable NAF demo box

A throwaway EC2 instance that serves the Blue Fleet / NAF sales demo over
HTTPS. It exists so the demo can be shown from a browser anywhere, and it is
built to be deleted the day after.

**It never touches production.** The box gets `backend/.env.demo` (the Neon
demo database and its own Upstash) copied as its `.env`; `backend/.env` — the
RDS credentials — is excluded from every sync. Every resource is tagged
`Project=fuelsense-demo` and `down.sh` finds them by that tag alone. The
production instance id is written into `common.sh` only so each script can
refuse it.

```
ops/demo-ec2/up.sh          # security group + t3.small (Amazon Linux 2023)
ops/demo-ec2/deploy.sh      # build the site, sync backend + site, start services
ops/demo-ec2/cloudfront.sh  # https URL on *.cloudfront.net (5-10 min to deploy)
ops/demo-ec2/down.sh        # delete all of it
ops/demo-ec2/laptop.sh      # run the API here against the box's database (simulator off)
```

The box keeps its own Postgres (`fuelsense_demo`, loopback only) — set up by
hand on 2026-09-16 after Neon's free transfer quota took the demo down. `.state`
carries its password and `deploy.sh` writes that URL into the box's `.env`.
Reseed with `DOTENV_CONFIG_PATH=.env npx tsx src/scripts/seed-blue-fleet.ts --fresh`
in `/home/ec2-user/backend` on the box.

Re-run `deploy.sh` to push changes. State (instance id, distribution id)
lives in `.state`, which is git-ignored.

Logins are the ones `npm run demo:seed` prints: the manager, `commander@naf.com`
and `logistics@naf.com`.

Cost while up: roughly $0.02/h for the instance plus CloudFront's per-request
pennies. Run `down.sh` when the demo is over.
