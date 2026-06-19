#!/bin/bash
cd "$(dirname "$0")"
VERCEL_TOKEN=vcp_210z2tschKiEaj52IwAqqhjDD7hFXlrYAxSghWOQlsifeLuIan0zwqgI npx vercel --prod --yes
