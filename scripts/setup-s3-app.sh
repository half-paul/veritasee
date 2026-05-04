#!/usr/bin/env bash
set -euo pipefail

# =========================
# Config - change these
# =========================
ADMIN_PROFILE="${ADMIN_PROFILE:-akanewmedia-nonprod}"
AWS_REGION="${AWS_REGION:-ca-central-1}"
S3_BUCKET="${S3_BUCKET:-raisin-app-uploads-$(date +%s)}"
IAM_USER="${IAM_USER:-app-s3-raisin}"
POLICY_NAME="${POLICY_NAME:-app-s3-raisin-rw-delete}"
TEST_PROFILE="${TEST_PROFILE:-s3-app-test}"
ENABLE_VERSIONING="${ENABLE_VERSIONING:-false}"

STATE_FILE="${STATE_FILE:-./s3-app-state.env}"
ENV_FILE="${ENV_FILE:-./.env.s3}"
POLICY_FILE="${POLICY_FILE:-./s3-rw-delete-policy.json}"

echo "Using admin AWS profile: $ADMIN_PROFILE"
echo "Using AWS region:        $AWS_REGION"
echo "Using S3 bucket:         $S3_BUCKET"
echo "Using IAM user:          $IAM_USER"
echo "Using test profile:      $TEST_PROFILE"

echo
echo "Checking AWS CLI identity..."
aws sts get-caller-identity --profile "$ADMIN_PROFILE"

echo
echo "Creating S3 bucket..."

if [[ "$AWS_REGION" == "us-east-1" ]]; then
  aws s3api create-bucket \
    --bucket "$S3_BUCKET" \
    --region "$AWS_REGION" \
    --profile "$ADMIN_PROFILE"
else
  aws s3api create-bucket \
    --bucket "$S3_BUCKET" \
    --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION" \
    --profile "$ADMIN_PROFILE"
fi

echo
echo "Enabling S3 Block Public Access..."
aws s3api put-public-access-block \
  --bucket "$S3_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
  --profile "$ADMIN_PROFILE"

echo
echo "Enabling default SSE-S3 encryption..."
aws s3api put-bucket-encryption \
  --bucket "$S3_BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }' \
  --profile "$ADMIN_PROFILE"

if [[ "$ENABLE_VERSIONING" == "true" ]]; then
  echo
  echo "Enabling bucket versioning..."
  aws s3api put-bucket-versioning \
    --bucket "$S3_BUCKET" \
    --versioning-configuration Status=Enabled \
    --profile "$ADMIN_PROFILE"
else
  echo
  echo "Bucket versioning not enabled. Set ENABLE_VERSIONING=true if you want it."
fi

echo
echo "Creating IAM user..."
aws iam create-user \
  --user-name "$IAM_USER" \
  --profile "$ADMIN_PROFILE" >/dev/null

echo
echo "Creating IAM policy document..."

cat > "$POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketLevelAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::$S3_BUCKET"
    },
    {
      "Sid": "ObjectReadWriteDeleteAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::$S3_BUCKET/*"
    }
  ]
}
EOF

echo
echo "Creating IAM policy..."
POLICY_ARN=$(aws iam create-policy \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://$POLICY_FILE" \
  --query 'Policy.Arn' \
  --output text \
  --profile "$ADMIN_PROFILE")

echo "Policy ARN: $POLICY_ARN"

echo
echo "Attaching policy to IAM user..."
aws iam attach-user-policy \
  --user-name "$IAM_USER" \
  --policy-arn "$POLICY_ARN" \
  --profile "$ADMIN_PROFILE"

echo
echo "Creating IAM access key..."
ACCESS_KEY_JSON=$(aws iam create-access-key \
  --user-name "$IAM_USER" \
  --profile "$ADMIN_PROFILE")

ACCESS_KEY_ID=$(echo "$ACCESS_KEY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['AccessKeyId'])")
SECRET_ACCESS_KEY=$(echo "$ACCESS_KEY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['SecretAccessKey'])")

echo
echo "Writing app env file: $ENV_FILE"

cat > "$ENV_FILE" <<EOF
S3_ENDPOINT=https://s3.$AWS_REGION.amazonaws.com
S3_REGION=$AWS_REGION
S3_ACCESS_KEY_ID=$ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY
S3_BUCKET=$S3_BUCKET
EOF

chmod 600 "$ENV_FILE"

echo
echo "Writing cleanup state file: $STATE_FILE"

cat > "$STATE_FILE" <<EOF
ADMIN_PROFILE=$ADMIN_PROFILE
AWS_REGION=$AWS_REGION
S3_BUCKET=$S3_BUCKET
IAM_USER=$IAM_USER
POLICY_NAME=$POLICY_NAME
POLICY_ARN=$POLICY_ARN
ACCESS_KEY_ID=$ACCESS_KEY_ID
TEST_PROFILE=$TEST_PROFILE
ENV_FILE=$ENV_FILE
POLICY_FILE=$POLICY_FILE
EOF

chmod 600 "$STATE_FILE"

echo
echo "Configuring test AWS CLI profile: $TEST_PROFILE"

aws configure set aws_access_key_id "$ACCESS_KEY_ID" --profile "$TEST_PROFILE"
aws configure set aws_secret_access_key "$SECRET_ACCESS_KEY" --profile "$TEST_PROFILE"
aws configure set region "$AWS_REGION" --profile "$TEST_PROFILE"
aws configure set output json --profile "$TEST_PROFILE"

echo
echo "Testing write access..."
echo "S3 read/write/delete test - $(date)" > test-s3.txt

aws s3 cp test-s3.txt "s3://$S3_BUCKET/test-s3.txt" \
  --profile "$TEST_PROFILE"

echo
echo "Testing list access..."
aws s3 ls "s3://$S3_BUCKET/" \
  --profile "$TEST_PROFILE"

echo
echo "Testing read access..."
aws s3 cp "s3://$S3_BUCKET/test-s3.txt" downloaded-test-s3.txt \
  --profile "$TEST_PROFILE"

cat downloaded-test-s3.txt

echo
echo "Testing delete access..."
aws s3 rm "s3://$S3_BUCKET/test-s3.txt" \
  --profile "$TEST_PROFILE"

rm -f test-s3.txt downloaded-test-s3.txt

echo
echo "Done."
echo
echo "Your app env file is:"
echo "$ENV_FILE"
echo
cat "$ENV_FILE"