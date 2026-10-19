#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node scripts/check-node.mjs
npm start
