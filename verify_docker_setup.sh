#!/bin/bash
# verify_docker_setup.sh
# Verifies Docker installation, configuration, and file access permissions.

set -e

echo "🔍 Starting Docker Setup Verification..."

# 1. Check Docker Installation
echo -n "Checking Docker... "
if command -v docker &> /dev/null; then
    echo "✅ Installed ($(docker --version))"
else
    echo "❌ Not found. Please install Docker first."
    exit 1
fi

echo -n "Checking Docker Compose... "
if docker compose version &> /dev/null; then
    echo "✅ Installed"
else
    echo "❌ Not found (plugin). Try 'docker-compose'?"
    exit 1
fi

# 2. Check User Group
echo -n "Checking user permissions... "
if groups | grep -q "docker"; then
    echo "✅ User is in 'docker' group"
else
    echo "⚠️  User is NOT in 'docker' group. You may need 'sudo'."
fi

# 3. Check Directories
PROJECTS_DIR="/var/lib/photo-manager/projects"
echo -n "Checking projects directory ($PROJECTS_DIR)... "
if [ -d "$PROJECTS_DIR" ]; then
    echo "✅ Exists"
    # Check write permission
    if [ -w "$PROJECTS_DIR" ]; then
        echo "   ✅ Writeable by current user"
    else
        echo "   ⚠️  Not writeable by current user (might need sudo or chown)"
    fi
else
    echo "❌ Not found. Run ./setup-ubuntu-host.sh first."
fi

# 4. Validate docker-compose.yml
echo -n "Validating docker-compose.yml... "
if [ -f "docker-compose.yml" ]; then
    if docker compose config > /dev/null 2>&1; then
        echo "✅ Valid Syntax"
    else
        echo "❌ Invalid Syntax. Check file."
        docker compose config
        exit 1
    fi
else
    echo "❌ File not found in current directory."
    exit 1
fi

# 5. Check Port Availability
echo -n "Checking port 5000... "
if command -v netstat &> /dev/null; then
    if netstat -tuln | grep -q ":5000 "; then
        PORT_IN_USE=true
    fi
elif command -v ss &> /dev/null; then
    if ss -tuln | grep -q ":5000 "; then
        PORT_IN_USE=true
    fi
else
    echo "⚠️  Could not check port (netstat/ss missing)"
    PORT_IN_USE=false
fi

if [ "$PORT_IN_USE" = true ]; then
    echo "⚠️  Port 5000 is already in use. Stop existing containers?"
else
    echo "✅ Port 5000 is free"
fi

echo ""
echo "🎉 Verification Complete!"
echo "To start the app, run: docker compose up -d"
