console.log(`
Asset Ingestion Component Validation Commands

  npm run validate:drive -- --folder-id <GOOGLE_DRIVE_FOLDER_ID>
  npm run validate:image -- --file <PATH_TO_IMAGE>
  npm run validate:s3 -- --file <PATH_TO_IMAGE> [--prefix validation]
  npm run validate:vision -- --file <PATH_TO_IMAGE>
  npm run validate:embedding -- [--text "sample text"]
  npm run validate:vector -- [--asset-id <ASSET_ID>] [--text "sample"] [--top-k 5]
  npm run validate:search -- --query "orange cat"
  npm run validate:cache -- [--query "orange cat"]
  npm run validate:sqs -- [--queue ingestion]

Notes:
  - Requires a configured .env.local or .env with real credentials for the target module.
  - SQS workers and Redis are disabled automatically for validation scripts (except validate:cache keeps Redis).
  - These commands exercise one module at a time and do not run the full pipeline unless noted.
`);
