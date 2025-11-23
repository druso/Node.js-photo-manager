#!/bin/bash
# Setup script for Ubuntu host with Cloudflare Tunnel
# This prepares the host filesystem for the Photo Manager application

set -e

echo "=========================================="
echo "Photo Manager: Ubuntu Host Setup"
echo "=========================================="
echo ""

# Configuration
PROJECTS_DIR="/var/lib/photo-manager/projects"
DB_DIR="/var/lib/photo-manager/db"

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  This script needs sudo privileges to create directories in /var/lib"
    echo "Please run with: sudo $0"
    exit 1
fi

echo "Step 1: Creating directories..."
mkdir -p "$PROJECTS_DIR"
mkdir -p "$DB_DIR"
echo "✓ Created: $PROJECTS_DIR"
echo "✓ Created: $DB_DIR"

echo ""
echo "Step 2: Setting ownership (user 1000:1000)..."
chown -R 1000:1000 "$PROJECTS_DIR"
chown -R 1000:1000 "$DB_DIR"
echo "✓ Ownership set to 1000:1000"

echo ""
echo "Step 3: Setting permissions..."
chmod -R 755 "$PROJECTS_DIR"
chmod -R 755 "$DB_DIR"
echo "✓ Permissions set to 755"

echo ""
echo "=========================================="
echo "✓ Ubuntu Host Setup Complete!"
echo "=========================================="
echo ""
echo "Directory structure:"
echo "  $PROJECTS_DIR - Photos and project files (accessible from host)"
echo "  $DB_DIR - Database files (accessible from host)"
echo ""
echo "Access your photos on Ubuntu:"
echo "  cd $PROJECTS_DIR"
echo "  ls -lah"
echo ""
echo "You can now:"
echo "  1. Start the application: docker compose up -d"
echo "  2. Access photos directly: $PROJECTS_DIR"
echo "  3. Use rsync, scp, or any tool to manage files"
echo "  4. Set up Cloudflare Tunnel to expose the app"
echo ""
echo "Cloudflare Tunnel setup:"
echo "  - Install cloudflared on Ubuntu"
echo "  - Point tunnel to http://localhost:5000"
echo "  - Update ALLOWED_ORIGINS in docker-compose.yml with your tunnel URL"
echo ""
