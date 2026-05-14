#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${STATE_FILE:-./s3-app-state.env}"
DELETE_BUCKET="${DELETE_BUCKET:-false}"
DELETE_LOCAL_FILES="${DELETE_LOCAL_FILES:-false}"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "State file not found: $STATE_FILE"
  echo "Run this from the same directory where setup-s3-app.sh created s3-app-state.env"
  exit 1
fi

# shellcheck disable=SC1090
source "$STATE_FILE"

echo "Loaded state from: $STATE_FILE"
echo "Admin profile:     $ADMIN_PROFILE"
echo "Region:            $AWS_REGION"
echo "Bucket:            $S3_BUCKET"
echo "IAM user:          $IAM_USER"
echo "Policy ARN:        $POLICY_ARN"
echo "Access key ID:     $ACCESS_KEY_ID"
echo "Test profile:      $TEST_PROFILE"

echo
echo "Checking AWS CLI identity..."
aws sts get-caller-identity --profile "$ADMIN_PROFILE"

echo
echo "Deleting IAM access key if it exists..."
if aws iam list-access-keys \
  --user-name "$IAM_USER" \
  --profile "$ADMIN_PROFILE" \
  --query "AccessKeyMetadata[?AccessKeyId=='$ACCESS_KEY_ID'].AccessKeyId" \
  --output text | grep -q "$ACCESS_KEY_ID"; then

  aws iam delete-access-key \
    --user-name "$IAM_USER" \
    --access-key-id "$ACCESS_KEY_ID" \
    --profile "$ADMIN_PROFILE"

  echo "Deleted access key: $ACCESS_KEY_ID"
else
  echo "Access key not found or already deleted."
fi

echo
echo "Detaching IAM policy if attached..."
if aws iam list-attached-user-policies \
  --user-name "$IAM_USER" \
  --profile "$ADMIN_PROFILE" \
  --query "AttachedPolicies[?PolicyArn=='$POLICY_ARN'].PolicyArn" \
  --output text | grep -q "$POLICY_ARN"; then

  aws iam detach-user-policy \
    --user-name "$IAM_USER" \
    --policy-arn "$POLICY_ARN" \
    --profile "$ADMIN_PROFILE"

  echo "Detached policy: $POLICY_ARN"
else
  echo "Policy not attached or already detached."
fi

echo
echo "Deleting IAM policy if it exists..."
if aws iam get-policy \
  --policy-arn "$POLICY_ARN" \
  --profile "$ADMIN_PROFILE" >/dev/null 2>&1; then

  # Delete non-default policy versions first, if any.
  VERSION_IDS=$(aws iam list-policy-versions \
    --policy-arn "$POLICY_ARN" \
    --profile "$ADMIN_PROFILE" \
    --query "Versions[?IsDefaultVersion==\`false\`].VersionId" \
    --output text)

  for VERSION_ID in $VERSION_IDS; do
    aws iam delete-policy-version \
      --policy-arn "$POLICY_ARN" \
      --version-id "$VERSION_ID" \
      --profile "$ADMIN_PROFILE"
  done

  aws iam delete-policy \
    --policy-arn "$POLICY_ARN" \
    --profile "$ADMIN_PROFILE"

  echo "Deleted policy: $POLICY_ARN"
else
  echo "Policy not found or already deleted."
fi

echo
echo "Deleting IAM user if it exists..."
if aws iam get-user \
  --user-name "$IAM_USER" \
  --profile "$ADMIN_PROFILE" >/dev/null 2>&1; then

  aws iam delete-user \
    --user-name "$IAM_USER" \
    --profile "$ADMIN_PROFILE"

  echo "Deleted IAM user: $IAM_USER"
else
  echo "IAM user not found or already deleted."
fi

echo
echo "Removing local AWS CLI test profile entries..."

AWS_CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-$HOME/.aws/config}"

remove_ini_profile() {
  local file="$1"
  local profile_header="$2"

  if [[ -f "$file" ]]; then
    cp "$file" "$file.bak.$(date +%Y%m%d%H%M%S)"

    awk -v profile="$profile_header" '
      BEGIN { skip = 0 }
      /^\[/ {
        if ($0 == profile) {
          skip = 1
          next
        } else {
          skip = 0
        }
      }
      skip == 0 { print }
    ' "$file" > "$file.tmp"

    mv "$file.tmp" "$file"
  fi
}

remove_ini_profile "$AWS_CREDENTIALS_FILE" "[$TEST_PROFILE]"
remove_ini_profile "$AWS_CONFIG_FILE" "[profile $TEST_PROFILE]"

echo "Removed profile '$TEST_PROFILE' from:"
echo "  $AWS_CREDENTIALS_FILE"
echo "  $AWS_CONFIG_FILE"
echo "Backup files were created before editing."

if [[ "$DELETE_BUCKET" == "true" ]]; then
  echo
  echo "DELETE_BUCKET=true was set."
  echo "Emptying and deleting bucket: $S3_BUCKET"

  VERSIONING_STATUS=$(aws s3api get-bucket-versioning \
    --bucket "$S3_BUCKET" \
    --profile "$ADMIN_PROFILE" \
    --query 'Status' \
    --output text 2>/dev/null || echo "None")

  if [[ "$VERSIONING_STATUS" == "Enabled" || "$VERSIONING_STATUS" == "Suspended" ]]; then
    echo "Bucket has versioning status: $VERSIONING_STATUS"

    if ! command -v jq >/dev/null 2>&1; then
      echo "jq is required to fully empty a versioned bucket."
      echo "Install jq, for example: brew install jq"
      exit 1
    fi

    echo "Deleting all object versions and delete markers..."

    while true; do
      VERSIONS_JSON=$(aws s3api list-object-versions \
        --bucket "$S3_BUCKET" \
        --profile "$ADMIN_PROFILE" \
        --output json)

      DELETE_JSON=$(echo "$VERSIONS_JSON" | jq '{
        Objects: (
          [.Versions[]? | {Key: .Key, VersionId: .VersionId}] +
          [.DeleteMarkers[]? | {Key: .Key, VersionId: .VersionId}]
        ),
        Quiet: true
      }')

      OBJECT_COUNT=$(echo "$DELETE_JSON" | jq '.Objects | length')

      if [[ "$OBJECT_COUNT" -eq 0 ]]; then
        break
      fi

      echo "$DELETE_JSON" > delete-objects.json

      aws s3api delete-objects \
        --bucket "$S3_BUCKET" \
        --delete file://delete-objects.json \
        --profile "$ADMIN_PROFILE" >/dev/null

      rm -f delete-objects.json
    done
  else
    echo "Bucket is not versioned. Removing objects recursively..."
    aws s3 rm "s3://$S3_BUCKET" \
      --recursive \
      --profile "$ADMIN_PROFILE" || true
  fi

  echo "Deleting bucket..."
  aws s3api delete-bucket \
    --bucket "$S3_BUCKET" \
    --region "$AWS_REGION" \
    --profile "$ADMIN_PROFILE"

  echo "Deleted bucket: $S3_BUCKET"
else
  echo
  echo "Bucket was NOT deleted."
  echo "To delete the bucket too, run:"
  echo "DELETE_BUCKET=true ./delete-s3-app.sh"
fi

if [[ "$DELETE_LOCAL_FILES" == "true" ]]; then
  echo
  echo "Deleting local generated files..."
  rm -f "$ENV_FILE" "$POLICY_FILE" "$STATE_FILE"
fi

echo
echo "Cleanup done."