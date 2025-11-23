# Docker Volumes Separation - November 17, 2024

## Objective
Separate persistent data (database and project files) from application code in Docker setup.

## Problem
Previously, the Docker setup mixed application code and persistent data in the same container/volumes:
- Database (`.db/`) was not explicitly mounted, risking data loss on container rebuild
- Projects (`.projects/`) used a bind mount to local directory
- No clear separation between code and data
- Difficult to update application without affecting data
- No standardized backup/restore procedures

## Solution Implemented

### 1. Docker Named Volumes
Created two named volumes in `docker-compose.yml`:
- **`photo-manager-db`**: Stores SQLite database (`.db/user_0.sqlite`)
- **`photo-manager-projects`**: Stores all project folders and images

### 2. Updated Configuration Files

**docker-compose.yml**:
```yaml
volumes:
  # Persist database in named volume (separate from app code)
  - photo-manager-db:/app/.db
  # Persist project files and images in named volume (separate from app code)
  - photo-manager-projects:/app/.projects
  # Persist runtime configuration (edit on host)
  - ./config.json:/app/config.json

# Named volumes for persistent data (survives container rebuilds)
volumes:
  photo-manager-db:
    driver: local
  photo-manager-projects:
    driver: local
```

**.dockerignore**:
- Added `.db` directory to prevent local database from being copied into image

### 3. Documentation Created

**DOCKER_VOLUMES.md** - Comprehensive guide covering:
- Volume overview and benefits
- Management commands (list, inspect, size)
- Backup and restore procedures
- Migration from bind mounts
- Accessing volume data
- Cleanup procedures
- Best practices
- Troubleshooting

**migrate-to-volumes.sh** - Automated migration script:
- Stops existing containers
- Creates new volumes
- Copies data from local directories to volumes
- Sets correct permissions
- Starts application with new setup
- Provides verification steps

### 4. Updated README.md
- Added Docker volumes section
- Updated containerization instructions
- Referenced DOCKER_VOLUMES.md for detailed procedures

## Benefits

### Data Safety
- ✅ Data persists across container rebuilds
- ✅ Application updates don't affect data
- ✅ Clear separation of concerns

### Operational
- ✅ Easy backup and restore
- ✅ Simple migration between hosts
- ✅ Standard Docker volume management
- ✅ No local directory clutter

### Development
- ✅ Clean Docker images (no data in image)
- ✅ Consistent across environments
- ✅ Better .dockerignore hygiene

## Migration Path

For existing users with data in `.db/` and `.projects/`:

1. **Automated** (recommended):
   ```bash
   ./migrate-to-volumes.sh
   ```

2. **Manual**:
   ```bash
   # Stop containers
   docker-compose down
   
   # Create volumes
   docker volume create photo-manager-db
   docker volume create photo-manager-projects
   
   # Copy data
   docker run --rm -v $(pwd)/.db:/source -v photo-manager-db:/dest \
     alpine sh -c "cp -av /source/* /dest/"
   docker run --rm -v $(pwd)/.projects:/source -v photo-manager-projects:/dest \
     alpine sh -c "cp -av /source/* /dest/"
   
   # Fix permissions
   docker run --rm -v photo-manager-db:/db -v photo-manager-projects:/projects \
     alpine chown -R 1000:1000 /db /projects
   
   # Start with new setup
   docker-compose up -d
   ```

3. **Verify**:
   - Check logs: `docker-compose logs -f`
   - Access app: http://localhost:5000
   - Verify projects and photos are visible

4. **Cleanup** (after verification):
   ```bash
   # Backup first!
   tar czf backups/db-backup.tar.gz .db
   tar czf backups/projects-backup.tar.gz .projects
   
   # Then remove
   rm -rf .db .projects
   ```

## Backup Procedures

### Quick Backup
```bash
# Database
docker run --rm -v photo-manager-db:/data -v $(pwd)/backups:/backup \
  alpine tar czf /backup/db-backup-$(date +%Y%m%d).tar.gz -C /data .

# Projects
docker run --rm -v photo-manager-projects:/data -v $(pwd)/backups:/backup \
  alpine tar czf /backup/projects-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### Quick Restore
```bash
# Database
docker run --rm -v photo-manager-db:/data -v $(pwd)/backups:/backup \
  alpine sh -c "cd /data && tar xzf /backup/db-backup-YYYYMMDD.tar.gz"

# Projects
docker run --rm -v photo-manager-projects:/data -v $(pwd)/backups:/backup \
  alpine sh -c "cd /data && tar xzf /backup/projects-backup-YYYYMMDD.tar.gz"
```

## Testing

### Verification Steps
1. ✅ Build and start containers: `docker-compose up --build`
2. ✅ Verify volumes created: `docker volume ls`
3. ✅ Check volume contents: 
   ```bash
   docker run --rm -v photo-manager-db:/data alpine ls -lah /data
   docker run --rm -v photo-manager-projects:/data alpine ls -lah /data
   ```
4. ✅ Access application and verify functionality
5. ✅ Test backup procedure
6. ✅ Test restore procedure

### Test Scenarios
- [x] Fresh installation (no existing data)
- [x] Migration from bind mounts (with existing data)
- [x] Container rebuild preserves data
- [x] Application update preserves data
- [x] Backup and restore procedures work

## Files Modified

### Configuration
- `docker-compose.yml` - Added named volumes
- `.dockerignore` - Added `.db` directory

### Documentation
- `README.md` - Updated containerization section
- `DOCKER_VOLUMES.md` - New comprehensive guide (created)
- `migrate-to-volumes.sh` - Migration script (created)
- `tasks_progress/docker_volumes_separation_nov17.md` - This file (created)

## Security Considerations

### Permissions
- Volumes use user `1000:1000` matching container user
- No root access required for normal operations
- Read-only mounts possible for config files

### Isolation
- Data isolated from application code
- No accidental data inclusion in images
- Clear boundary between mutable and immutable

### Backup Security
- Backup procedures documented
- Restore procedures tested
- No credentials in volume data (use env vars)

## Future Enhancements

### Potential Improvements
1. **Automated Backups**: Cron job or systemd timer for regular backups
2. **Remote Backups**: S3/cloud storage integration
3. **Volume Encryption**: Encrypted volumes for sensitive data
4. **Multi-host**: Volume drivers for distributed setups
5. **Monitoring**: Volume size alerts and monitoring

### Not Implemented (Out of Scope)
- Automated backup scheduling (user responsibility)
- Cloud backup integration (user choice)
- Volume encryption (Docker/host level)
- High availability setup (single-host focus)

## Rollback Plan

If issues arise, revert to bind mounts:

1. Stop containers: `docker-compose down`
2. Restore data from volumes to local:
   ```bash
   docker run --rm -v photo-manager-db:/data -v $(pwd):/host \
     alpine cp -r /data /host/.db
   docker run --rm -v photo-manager-projects:/data -v $(pwd):/host \
     alpine cp -r /data /host/.projects
   ```
3. Revert `docker-compose.yml` changes
4. Start: `docker-compose up -d`

## Conclusion

Successfully implemented Docker volume separation for persistent data:
- ✅ Database and projects stored in named volumes
- ✅ Clear separation from application code
- ✅ Easy backup and restore procedures
- ✅ Migration path for existing users
- ✅ Comprehensive documentation
- ✅ Automated migration script

This change follows Docker best practices and makes the application more maintainable, portable, and production-ready.

## References

- Docker Volumes: https://docs.docker.com/storage/volumes/
- Docker Compose Volumes: https://docs.docker.com/compose/compose-file/compose-file-v3/#volumes
- Best Practices: https://docs.docker.com/develop/dev-best-practices/
