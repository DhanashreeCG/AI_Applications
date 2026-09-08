#!/bin/bash
set -e

# --- CONFIGURATION ---
PROFILE_NAME="react-deployer" # The name of the local profile to use/create
BUCKET_NAME="cg-game-workspace"
DISTRIBUTION_ID="E2YUHEHHS9807X"
BUILD_DIR="public" # Change to "dist" if using Vite
# ---------------------

# Step 0: Check if the profile already exists
if ! aws configure get aws_access_key_id --profile "$PROFILE_NAME" &> /dev/null; then
    echo "⚠️  AWS Profile '$PROFILE_NAME' not found."
    echo "🔐 Let's configure it for the first time:"
    
    # Prompt user for inputs
    read -p "Enter AWS Access Key ID: " ACCESS_KEY
    read -sp "Enter AWS Secret Access Key: " SECRET_KEY
    echo "" # New line after hidden secret input
    read -p "Enter Default Region (e.g., us-east-1): " REGION

    # Save credentials to the local machine permanently
    aws configure set aws_access_key_id "$ACCESS_KEY" --profile "$PROFILE_NAME"
    aws configure set aws_secret_access_key "$SECRET_KEY" --profile "$PROFILE_NAME"
    aws configure set region "$REGION" --profile "$PROFILE_NAME"
    aws configure set output "json" --profile "$PROFILE_NAME"
    
    echo "✅ Setup complete! Credentials saved locally under profile: $PROFILE_NAME"
else
    echo "🔑 Found existing AWS Profile: '$PROFILE_NAME'. Using saved credentials."
fi

# Tell all subsequent AWS CLI commands to use this specific profile
export AWS_PROFILE="$PROFILE_NAME"

echo "📦 Step 1: Building React Application..."
#npm run build

echo "🚀 Step 2: Syncing public folder to AWS S3 as-is..."
aws s3 sync "$BUILD_DIR/" "s3://$BUCKET_NAME/flashcards/" --delete

echo "♻️ Step 3: Invalidating CloudFront Cache..."
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"

echo "✅ Deployment completed successfully!"
