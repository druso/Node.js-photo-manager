#!/bin/bash
# Migration script: Move existing data from bind mounts to Docker volumes
# Run this script to migrate from the old setup to the new volume-based setup

set -e

# Ensure we are in the project root
cd "$(dirname "$0")/.." || exit 1

echo "=========================================="
echo "Photo Manager: Migrate to Docker Volumes"
echo "=========================================="
echo ""

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not in PATH"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Error: docker-compose is not installed or not in PATH"
    exit 1
fi

# Use docker compose or docker-compose
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

echo "Step 1: Stopping existing containers..."
$COMPOSE_CMD down

echo ""
echo "Step 2: Creating Docker volumes..."
docker volume create photo-manager-db 2>/dev/null || echo "Volume photo-manager-db already exists"
docker volume create photo-manager-projects 2>/dev/null || echo "Volume photo-manager-projects already exists"

echo ""
echo "Step 3: Checking for existing data..."

DB_EXISTS=false
PROJECTS_EXISTS=false

if [ -d ".db" ] && [ "$(ls -A .db 2>/dev/null)" ]; then
    echo "✓ Found existing database in .db/"
    DB_EXISTS=true
else
    echo "ℹ No existing database found in .db/"
fi

if [ -d ".projects" ] && [ "$(ls -A .projects 2>/dev/null)" ]; then
    echo "✓ Found existing projects in .projects/"
    PROJECTS_EXISTS=true
else
    echo "ℹ No existing projects found in .projects/"
fi

# Migrate database if exists
if [ "$DB_EXISTS" = true ]; then
    echo ""
    echo "Step 4a: Migrating database to volume..."
    docker run --rm \
        -v "$(pwd)/.db:/source:ro" \
        -v photo-manager-db:/dest \
        alpine sh -c "cp -av /source/* /dest/ && ls -lah /dest"
    echo "✓ Database migration complete"
else
    echo ""
    echo "Step 4a: Skipping database migration (no data found)"
fi

# Migrate projects if exists
if [ "$PROJECTS_EXISTS" = true ]; then
    echo ""
    echo "Step 4b: Migrating projects to volume..."
    echo "This may take a while depending on the size of your photo collection..."
    docker run --rm \
        -v "$(pwd)/.projects:/source:ro" \
        -v photo-manager-projects:/dest \
        alpine sh -c "cp -av /source/* /dest/ && echo 'Files copied:' && du -sh /dest"
    echo "✓ Projects migration complete"
else
    echo ""
    echo "Step 4b: Skipping projects migration (no data found)"
fi

echo ""
echo "Step 5: Setting correct permissions..."
docker run --rm \
    -v photo-manager-db:/db \
    -v photo-manager-projects:/projects \
    alpine sh -c "chown -R 1000:1000 /db /projects && echo 'Permissions set to 1000:1000'"

echo ""
echo "Step 6: Starting application with new volumes..."
$COMPOSE_CMD up -d

echo ""
echo "=========================================="
echo "✓ Migration Complete!"
echo "=========================================="
echo ""
echo "Your data is now stored in Docker volumes:"
echo "  - photo-manager-db (database)"
echo "  - photo-manager-projects (images)"
echo ""
echo "Next steps:"
echo "  1. Check logs: $COMPOSE_CMD logs -f"
echo "  2. Access app: http://localhost:5000"
echo "  3. Verify your projects and photos are visible"
echo ""

if [ "$DB_EXISTS" = true ] || [ "$PROJECTS_EXISTS" = true ]; then
    echo "After verifying everything works:"
    echo "  - You can safely remove the old .db/ and .projects/ directories"
    echo "  - Keep backups before removing!"
    echo ""
    echo "To backup old data:"
    echo "  mkdir -p backups"
    if [ "$DB_EXISTS" = true ]; then
        echo "  tar czf backups/db-backup-\$(date +%Y%m%d).tar.gz .db"
    fi
    if [ "$PROJECTS_EXISTS" = true ]; then
        echo "  tar czf backups/projects-backup-\$(date +%Y%m%d).tar.gz .projects"
    fi
    echo ""
fi

echo "For volume management commands, see DOCKER_VOLUMES.md"
echo ""
