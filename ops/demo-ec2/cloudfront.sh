#!/usr/bin/env bash
# Put CloudFront in front of the demo box so the demo has an https URL with
# no domain to buy. One distribution, default certificate, caching off —
# CloudFront is here for TLS and a clean hostname, not for caching.
#
#   ops/demo-ec2/cloudfront.sh
source "$(dirname "$0")/common.sh"

INSTANCE_ID="$(state_get INSTANCE_ID)"
[ -n "$INSTANCE_ID" ] || INSTANCE_ID="$(demo_instance_ids | awk '{print $1}')"
refuse_prod "$INSTANCE_ID"
ORIGIN="$(demo_instance_dns "$INSTANCE_ID")"

DIST_ID="$(state_get DIST_ID)"
if [ -n "$DIST_ID" ]; then
  echo "distribution exists: https://$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)"; exit 0
fi

# Managed policies: CachingDisabled and AllViewer (forward every header,
# cookie and query string to the origin).
CACHE_POLICY="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ORIGIN_REQUEST_POLICY="216adef6-5c7f-47e4-b989-5492eafa07d3"

cat > "$HERE/.dist.json" <<JSON
{
  "CallerReference": "$NAME-$(date +%s)",
  "Comment": "$NAME - disposable NAF demo, no production data",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "PriceClass": "PriceClass_100",
  "Origins": { "Quantity": 1, "Items": [ {
    "Id": "demo-box", "DomainName": "$ORIGIN",
    "CustomOriginConfig": { "HTTPPort": 80, "HTTPSPort": 443, "OriginProtocolPolicy": "http-only",
      "OriginReadTimeout": 60, "OriginKeepaliveTimeout": 60,
      "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] } }
  } ] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "demo-box", "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "Compress": true,
    "CachePolicyId": "$CACHE_POLICY",
    "OriginRequestPolicyId": "$ORIGIN_REQUEST_POLICY"
  },
  "ViewerCertificate": { "CloudFrontDefaultCertificate": true }
}
JSON
OUT="$(aws cloudfront create-distribution --distribution-config file://"$HERE/.dist.json")"
rm -f "$HERE/.dist.json"
DIST_ID="$(echo "$OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Distribution"]["Id"])')"
DOMAIN="$(echo "$OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Distribution"]["DomainName"])')"
aws cloudfront tag-resource --resource "arn:aws:cloudfront::$(aws sts get-caller-identity --query Account --output text):distribution/$DIST_ID" \
  --tags "Items=[{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=$NAME}]"
state_set DIST_ID "$DIST_ID"
echo "distribution $DIST_ID deploying (5-10 min) → https://$DOMAIN"
