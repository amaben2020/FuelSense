#!/usr/bin/env bash
# Shared settings for the disposable NAF demo box. Sourced by the other scripts.
#
# Everything created here carries Project=fuelsense-demo and is found again by
# that tag alone, so `down.sh` can only ever remove what `up.sh` made. The
# production instance is named below purely so every script can refuse it.
set -euo pipefail

export AWS_REGION="${AWS_REGION:-eu-north-1}"
export AWS_PAGER=""

TAG_PROJECT="fuelsense-demo"
NAME="fuelsense-demo"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
KEY_NAME="${KEY_NAME:-fuelsense}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/fuelsense.pem}"
SSH_USER="ec2-user"

# The real FuelSense box. Never a target, never a match.
PROD_INSTANCE_ID="i-02365bd7ac603ace3"
PROD_IP="13.61.2.216"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STATE="$HERE/.state"

state_get() { [ -f "$STATE" ] && grep -E "^$1=" "$STATE" | head -1 | cut -d= -f2- || true; }
state_set() {
  touch "$STATE"
  grep -vE "^$1=" "$STATE" > "$STATE.tmp" || true
  echo "$1=$2" >> "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"
}

refuse_prod() {
  local id="${1:-}" ip="${2:-}"
  if [ "$id" = "$PROD_INSTANCE_ID" ] || [ "$ip" = "$PROD_IP" ]; then
    echo "REFUSED: $id $ip is the production FuelSense instance." >&2
    exit 1
  fi
}

demo_instance_ids() {
  aws ec2 describe-instances --region "$AWS_REGION" \
    --filters "Name=tag:Project,Values=$TAG_PROJECT" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text
}

demo_instance_dns() {
  local id="$1"
  aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$id" \
    --query 'Reservations[0].Instances[0].PublicDnsName' --output text
}

demo_instance_ip() {
  local id="$1"
  aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$id" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
}

# The SSH rule is pinned to whichever address the laptop had when the group
# was made. Re-pin it to today's before every deploy, dropping the old one.
allow_ssh_from_here() {
  local sg_id="$1" me
  me="$(curl -s --max-time 5 https://checkip.amazonaws.com)/32"
  local current
  current="$(aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$sg_id" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text)"
  for cidr in $current; do
    [ "$cidr" = "$me" ] && continue
    aws ec2 revoke-security-group-ingress --region "$AWS_REGION" --group-id "$sg_id" \
      --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$cidr}]" >/dev/null
  done
  if ! echo "$current" | grep -q "$me"; then
    aws ec2 authorize-security-group-ingress --region "$AWS_REGION" --group-id "$sg_id" \
      --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$me,Description=deploy from laptop}]" >/dev/null
    echo "ssh now allowed from $me"
  fi
}
