#!/bin/bash

# Auto-update script for Photo Manager
# Usage: Add to crontab to run periodically (e.g., every hour)
# 0 * * * * /path/to/your/app/auto_update.sh >> /var/log/photo-manager-update.log 2>&1

# Determine the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || { echo "Failed to change directory to $SCRIPT_DIR"; exit 1; }

# Log date
echo "Checking for updates: $(date)"

# Detect current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

# Fetch latest changes
git fetch origin "$CURRENT_BRANCH"

# Check if we are behind
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$CURRENT_BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "App is up to date."
    exit 0
fi

echo "New update found ($REMOTE). Updating..."

# Pull changes
if ! git pull origin "$CURRENT_BRANCH"; then
    echo "Error: Git pull failed."
    exit 1
fi

# Rebuild and restart containers
echo "Rebuilding Docker containers..."
if ! docker compose up -d --build; then
    echo "Error: Docker compose failed."
    exit 1
fi

# Cleanup unused images to save space
echo "Cleaning up old images..."
docker image prune -f

echo "Update successfully applied at $(date)."
