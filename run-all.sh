#!/usr/bin/env bash
# Full pipeline: roster -> set qualification -> round robin -> ratings. Every stage resumes.
set -euo pipefail
cd "$(dirname "$0")"
node src/roster.js
node src/qualify.js "$@"
node src/tournament.js "$@"
node src/rating.js
