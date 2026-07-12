#!/bin/bash
cd "$(dirname "$0")"
# Never hardcode the token. Pass it in from the environment:
#   VERCEL_TOKEN=xxx ./deploy.sh
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN (a Vercel token with team access). Never commit it.}"
npx vercel --prod --yes --token "$VERCEL_TOKEN"
