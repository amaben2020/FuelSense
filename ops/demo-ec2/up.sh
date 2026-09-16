#!/usr/bin/env bash
# Create the demo box: one security group, one instance. Nothing else.
#
#   ops/demo-ec2/up.sh
#
# Idempotent — a second run finds the existing tagged instance and stops.
source "$(dirname "$0")/common.sh"

if [ -n "$(demo_instance_ids)" ]; then
  echo "demo instance already exists: $(demo_instance_ids)"; exit 0
fi

MY_IP="$(curl -s --max-time 5 https://checkip.amazonaws.com)/32"
VPC_ID="$(aws ec2 describe-vpcs --region "$AWS_REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"

SG_ID="$(aws ec2 describe-security-groups --region "$AWS_REGION" \
  --filters "Name=tag:Project,Values=$TAG_PROJECT" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$(aws ec2 create-security-group --region "$AWS_REGION" --vpc-id "$VPC_ID" \
    --group-name "$NAME" --description "Disposable NAF demo box - no production data" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=$NAME}]" \
    --query GroupId --output text)"
  # 80 for CloudFront to fetch from; 22 from this machine only. The tracker
  # port is not opened: the demo's simulator connects over loopback.
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION" --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=CloudFront origin fetch}]" \
                     "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MY_IP,Description=deploy from laptop}]" >/dev/null
  echo "security group $SG_ID"
fi
state_set SG_ID "$SG_ID"

AMI="$(aws ssm get-parameter --region "$AWS_REGION" \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)"

INSTANCE_ID="$(aws ec2 run-instances --region "$AWS_REGION" \
  --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}' \
  --user-data file://"$HERE/user-data.sh" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=$NAME},{Key=Disposable,Value=true}]" \
                       "ResourceType=volume,Tags=[{Key=Project,Value=$TAG_PROJECT},{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)"
refuse_prod "$INSTANCE_ID"
state_set INSTANCE_ID "$INSTANCE_ID"
echo "instance $INSTANCE_ID starting…"
aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$INSTANCE_ID"
echo "instance $INSTANCE_ID running at $(demo_instance_ip "$INSTANCE_ID") ($(demo_instance_dns "$INSTANCE_ID"))"
echo "next: ops/demo-ec2/deploy.sh (wait ~2 min for first boot to install node and caddy)"
