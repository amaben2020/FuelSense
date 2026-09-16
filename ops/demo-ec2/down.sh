#!/usr/bin/env bash
# Remove the demo entirely: CloudFront distribution, instance (and its volume),
# security group. Finds everything by the Project=fuelsense-demo tag, so it
# cannot touch the production instance, which is also refused by id.
#
#   ops/demo-ec2/down.sh
source "$(dirname "$0")/common.sh"

DIST_ID="$(state_get DIST_ID)"
if [ -n "$DIST_ID" ]; then
  echo "== disabling CloudFront $DIST_ID"
  ETAG="$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)"
  aws cloudfront get-distribution-config --id "$DIST_ID" --query DistributionConfig \
    | python3 -c 'import sys,json; c=json.load(sys.stdin); c["Enabled"]=False; print(json.dumps(c))' > "$HERE/.dist.json"
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file://"$HERE/.dist.json" >/dev/null
  rm -f "$HERE/.dist.json"
  echo "   waiting for it to disable (this is the slow part, ~5-15 min)"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"
  ETAG="$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)"
  aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"
  echo "   deleted"
fi

for id in $(demo_instance_ids); do
  refuse_prod "$id"
  echo "== terminating $id"
  aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids "$id" >/dev/null
done
IDS="$(demo_instance_ids)"
if [ -n "$IDS" ]; then aws ec2 wait instance-terminated --region "$AWS_REGION" --instance-ids $IDS; fi

SG_ID="$(aws ec2 describe-security-groups --region "$AWS_REGION" \
  --filters "Name=tag:Project,Values=$TAG_PROJECT" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -n "$SG_ID" ] && [ "$SG_ID" != "None" ]; then
  echo "== deleting security group $SG_ID"
  # The ENI can linger for a few seconds after termination.
  for i in $(seq 1 12); do aws ec2 delete-security-group --region "$AWS_REGION" --group-id "$SG_ID" 2>/dev/null && break || sleep 5; done
fi
rm -f "$STATE"
echo "== demo removed. Nothing tagged $TAG_PROJECT remains."
