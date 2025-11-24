# Docker Volumes Management

This document explains how to manage the persistent data volumes for the Photo Manager application.

## Overview

The application uses **Docker named volumes** to store persistent data separately from the application code:

- **`photo-manager-db`**: SQLite database (`.db/user_0.sqlite`)
- **`photo-manager-projects`**: All project folders and images (`.projects/`)

This separation allows you to:
- Update the application without losing data
- Easily backup and restore data
- Migrate data between hosts
- Keep your Docker images clean

## Volume Commands

### List all volumes
```bash
docker volume ls
```

### Inspect a volume (see where it's stored on host)
```bash
docker volume inspect photo-manager-db
docker volume inspect photo-manager-projects
```

### View volume size
```bash
docker system df -v
```

## Backup and Restore

### Backup Database
```bash
# Create a backup of the database volume
docker run --rm \
  -v photo-manager-db:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/db-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

### Backup Projects (Images)
```bash
# Create a backup of the projects volume
docker run --rm \
  -v photo-manager-projects:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/projects-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

### Restore Database
```bash
# Restore database from backup
docker run --rm \
  -v photo-manager-db:/data \
  -v $(pwd)/backups:/backup \
  alpine sh -c "cd /data && tar xzf /backup/db-backup-YYYYMMDD-HHMMSS.tar.gz"
```

### Restore Projects
```bash
# Restore projects from backup
docker run --rm \
  -v photo-manager-projects:/data \
  -v $(pwd)/backups:/backup \
  alpine sh -c "cd /data && tar xzf /backup/projects-backup-YYYYMMDD-HHMMSS.tar.gz"
```

## Migration from Bind Mounts

If you're upgrading from the old bind mount setup (`./.projects:/app/.projects`), you need to migrate your existing data:

### 1. Stop the container
```bash
docker-compose down
```

### 2. Copy existing data to new volumes
```bash
# Create the volumes by starting the container once
docker-compose up -d
docker-compose down

# Copy database files
docker run --rm \
  -v $(pwd)/.db:/source \
  -v photo-manager-db:/dest \
  alpine sh -c "cp -av /source/* /dest/"

# Copy project files
docker run --rm \
  -v $(pwd)/.projects:/source \
  -v photo-manager-projects:/dest \
  alpine sh -c "cp -av /source/* /dest/"
```

### 3. Start the application
```bash
docker-compose up -d
```

### 4. Verify data is accessible
```bash
# Check logs
docker-compose logs -f

# Access the application at http://localhost:5000
```

### 5. (Optional) Remove old local directories
```bash
# Only after verifying everything works!
# Keep backups before removing
rm -rf ./.db
rm -rf ./.projects
```

## Accessing Volume Data

### Browse volume contents
```bash
# Database volume
docker run --rm -it \
  -v photo-manager-db:/data \
  alpine sh -c "ls -lah /data"

# Projects volume
docker run --rm -it \
  -v photo-manager-projects:/data \
  alpine sh -c "ls -lah /data"
```

### Copy files from volume to host
```bash
# Copy database to current directory
docker run --rm \
  -v photo-manager-db:/data \
  -v $(pwd):/host \
  alpine cp -r /data /host/db-copy

# Copy specific project
docker run --rm \
  -v photo-manager-projects:/data \
  -v $(pwd):/host \
  alpine cp -r /data/project-name--p1 /host/
```

## Cleanup

### Remove volumes (⚠️ DESTRUCTIVE - will delete all data!)
```bash
# Stop and remove containers first
docker-compose down

# Remove specific volume
docker volume rm photo-manager-db
docker volume rm photo-manager-projects

# Or remove all unused volumes
docker volume prune
```

## Volume Location on Host

Docker stores named volumes in:
- **Linux**: `/var/lib/docker/volumes/`
- **macOS/Windows**: Inside the Docker VM

To find exact location:
```bash
docker volume inspect photo-manager-db | grep Mountpoint
```

## Best Practices

1. **Regular Backups**: Schedule regular backups of both volumes
2. **Test Restores**: Periodically test your backup/restore process
3. **Monitor Size**: Keep an eye on volume sizes with `docker system df -v`
4. **Separate Backups**: Back up database and projects separately for flexibility
5. **Version Backups**: Keep multiple backup versions with timestamps

## Troubleshooting

### Permission Issues
If you encounter permission errors:
```bash
# Check volume ownership
docker run --rm -v photo-manager-db:/data alpine ls -la /data

# Fix ownership (use your user:group IDs)
docker run --rm -v photo-manager-db:/data alpine chown -R 1000:1000 /data
docker run --rm -v photo-manager-projects:/data alpine chown -R 1000:1000 /data
```

### Volume Not Found
If Docker can't find the volume:
```bash
# Recreate volumes
docker volume create photo-manager-db
docker volume create photo-manager-projects

# Then restore from backup
```

### Database Locked
If you get "database is locked" errors:
```bash
# Ensure only one container is running
docker-compose down
docker-compose up -d

# Check for stale lock files
docker run --rm -v photo-manager-db:/data alpine ls -la /data
```
