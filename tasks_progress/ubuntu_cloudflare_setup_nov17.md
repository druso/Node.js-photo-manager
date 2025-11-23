# Ubuntu + Cloudflare Tunnel Setup - November 17, 2024

## User Request

User wants to:
1. Host the application on Ubuntu with Cloudflare Tunnel
2. Access photos directly from the Ubuntu filesystem
3. Fix Docker Compose error

## Issues Identified

### 1. Docker Compose Command Error
**Problem**: User was using `docker-compose` (hyphen) which is the old Python-based v1.29.2
**Error**: `Not supported URL scheme http+docker`
**Solution**: Use `docker compose` (space) which is Docker Compose V2 (plugin-based)

### 2. Data Access Requirements
**Need**: Direct filesystem access to photos on Ubuntu host
**Solution**: Use bind mount instead of named volume for `.projects`

## Solution Implemented

### 1. Updated docker-compose.yml

Changed from named volume to bind mount for projects:

```yaml
volumes:
  # Database - Docker volume (managed by Docker)
  - photo-manager-db:/app/.db
  
  # Projects - Bind mount (direct host access)
  - /var/lib/photo-manager/projects:/app/.projects
  
  # Config - Bind mount
  - ./config.json:/app/config.json

volumes:
  photo-manager-db:
    driver: local
  # Removed photo-manager-projects volume
```

**Benefits**:
- ✅ Direct filesystem access at `/var/lib/photo-manager/projects/`
- ✅ Use standard Linux tools (rsync, scp, rclone, etc.)
- ✅ Easy backups with filesystem tools
- ✅ Database still in Docker volume (proper separation)

### 2. Created Setup Scripts

**setup-ubuntu-host.sh**:
- Creates `/var/lib/photo-manager/projects/` directory
- Sets ownership to 1000:1000 (matches container user)
- Sets permissions to 755
- Creates database volume
- Provides verification steps

**Usage**:
```bash
sudo ./setup-ubuntu-host.sh
```

### 3. Created Comprehensive Documentation

**UBUNTU_CLOUDFLARE_SETUP.md** - Complete guide covering:
- Architecture overview with diagram
- Prerequisites and installation
- Step-by-step setup (Docker, Cloudflare, Application)
- Filesystem access methods (rsync, scp, rclone, SSHFS)
- Backup strategies (filesystem + database)
- Monitoring and maintenance
- Troubleshooting
- Security considerations
- Performance optimization
- Advanced configurations

**QUICK_START_UBUNTU.md** - Quick reference:
- 5-minute setup steps
- Essential commands
- Common troubleshooting
- Quick reference card

### 4. Updated README.md

Added Ubuntu deployment section:
- Highlighted correct `docker compose` command (V2)
- Referenced Ubuntu setup guides
- Explained data persistence strategy
- Noted direct filesystem access capability

## Architecture

```
Ubuntu Host
├── /var/lib/photo-manager/projects/  ← Direct access
│   ├── project-1--p1/
│   │   ├── originals/
│   │   ├── thumbnails/
│   │   └── previews/
│   └── project-2--p2/
│       └── ...
│
├── Docker Container
│   ├── App Code
│   ├── /app/.projects → (bind mount to host)
│   └── /app/.db → (Docker volume)
│
└── Cloudflare Tunnel
    └── localhost:5000 → https://photos.yourdomain.com
```

## Cloudflare Tunnel Setup

### Installation
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

### Configuration
```bash
# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create photo-manager

# Configure
sudo nano /etc/cloudflared/config.yml
```

**config.yml**:
```yaml
tunnel: photo-manager
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: photos.yourdomain.com
    service: http://localhost:5000
  - service: http_status:404
```

### DNS and Service
```bash
# Route DNS
cloudflared tunnel route dns photo-manager photos.yourdomain.com

# Install as service
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### Application CORS Update
```yaml
environment:
  ALLOWED_ORIGINS: https://photos.yourdomain.com
```

## Filesystem Access Methods

### 1. Direct Access (on Ubuntu)
```bash
cd /var/lib/photo-manager/projects/
ls -lah
```

### 2. rsync (remote sync)
```bash
# Download from server
rsync -avz ubuntu:/var/lib/photo-manager/projects/ ./backup/

# Upload to server
rsync -avz ./photos/ ubuntu:/var/lib/photo-manager/projects/new-project/originals/
```

### 3. scp (secure copy)
```bash
scp ubuntu:/var/lib/photo-manager/projects/project-1/originals/photo.jpg ./
```

### 4. rclone (cloud sync)
```bash
rclone sync /var/lib/photo-manager/projects/ remote:backup/
```

### 5. SSHFS (mount remote filesystem)
```bash
sshfs ubuntu:/var/lib/photo-manager/projects/ ~/remote-photos/
```

## Backup Strategies

### Photos (Filesystem)
```bash
# Simple tar
sudo tar czf /backup/photos-$(date +%Y%m%d).tar.gz /var/lib/photo-manager/projects/

# Incremental rsync
rsync -avz --delete /var/lib/photo-manager/projects/ /backup/photos/
```

### Database (Docker Volume)
```bash
docker run --rm \
  -v photo-manager-db:/data \
  -v /backup:/backup \
  alpine tar czf /backup/db-$(date +%Y%m%d).tar.gz -C /data .
```

### Automated (Cron)
Created example cron script in documentation for daily backups.

## Security Considerations

### Firewall
```bash
# Only allow SSH (Cloudflare Tunnel handles HTTPS)
sudo ufw allow 22/tcp
sudo ufw enable
```

**Important**: Don't open port 5000 externally - Cloudflare Tunnel provides secure access.

### Permissions
- Projects directory: `755` (owner: 1000:1000)
- Individual files: `644`
- Environment file: `600`

### Updates
```bash
# Application
git pull && docker compose up --build -d

# System
sudo apt update && sudo apt upgrade -y

# Cloudflared
# Auto-updates via apt
```

## Testing Checklist

- [x] Docker Compose V2 command works
- [x] Configuration validates (`docker compose config`)
- [x] Bind mount path configured
- [x] Setup script created and executable
- [x] Comprehensive documentation created
- [x] Quick start guide created
- [x] README updated
- [x] Security considerations documented
- [x] Backup procedures documented
- [x] Troubleshooting guide included

## Files Created

### Scripts
- `setup-ubuntu-host.sh` - Ubuntu host preparation script
- `migrate-to-volumes.sh` - Migration script (from previous work)

### Documentation
- `UBUNTU_CLOUDFLARE_SETUP.md` - Complete deployment guide (15+ sections)
- `QUICK_START_UBUNTU.md` - Quick reference card
- `DOCKER_VOLUMES.md` - Volume management guide (from previous work)
- `tasks_progress/docker_volumes_separation_nov17.md` - Previous work
- `tasks_progress/ubuntu_cloudflare_setup_nov17.md` - This file

### Configuration
- `docker-compose.yml` - Updated with bind mount for projects
- `.dockerignore` - Added `.db` directory
- `README.md` - Updated containerization section

## Deployment Steps Summary

1. **Prepare Ubuntu Host**:
   ```bash
   sudo ./setup-ubuntu-host.sh
   ```

2. **Install Cloudflare Tunnel**:
   ```bash
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared-linux-amd64.deb
   cloudflared tunnel login
   cloudflared tunnel create photo-manager
   ```

3. **Configure Tunnel**:
   - Create `/etc/cloudflared/config.yml`
   - Route DNS
   - Install as service

4. **Configure Application**:
   - Set environment variables
   - Update ALLOWED_ORIGINS
   - Copy config.json

5. **Start Application**:
   ```bash
   docker compose up -d
   ```

6. **Access**:
   - Web: `https://photos.yourdomain.com`
   - Files: `/var/lib/photo-manager/projects/`

## Benefits of This Setup

### For User
- ✅ Direct filesystem access to photos
- ✅ Use familiar Linux tools (rsync, scp, etc.)
- ✅ Easy backups with standard tools
- ✅ Secure remote access via Cloudflare
- ✅ No port forwarding needed
- ✅ HTTPS automatically provided

### For Application
- ✅ Database in Docker volume (proper isolation)
- ✅ Photos on host filesystem (easy access)
- ✅ Clean separation of concerns
- ✅ Easy updates without data loss
- ✅ Standard Docker practices

### For Security
- ✅ No exposed ports (Cloudflare Tunnel)
- ✅ HTTPS by default
- ✅ Cloudflare DDoS protection
- ✅ Proper file permissions
- ✅ Isolated database

## Alternative Configurations

### Different Storage Location
Edit `docker-compose.yml`:
```yaml
volumes:
  - /home/user/photos:/app/.projects  # Home directory
  - /mnt/photos:/app/.projects        # External drive
  - /data/photos:/app/.projects       # Data partition
```

### Multiple Drives
```bash
# Mount external drive
sudo mount /dev/sdb1 /mnt/photos

# Update docker-compose.yml
volumes:
  - /mnt/photos:/app/.projects

# Add to /etc/fstab for auto-mount
```

## Monitoring

### Application
```bash
docker compose logs -f
docker compose ps
docker stats
```

### Cloudflare Tunnel
```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

### Disk Space
```bash
df -h /var/lib/photo-manager/
du -sh /var/lib/photo-manager/projects/*
```

## Common Issues and Solutions

### Issue 1: Docker Compose Error
**Symptom**: `Not supported URL scheme http+docker`
**Solution**: Use `docker compose` (space) not `docker-compose` (hyphen)

### Issue 2: Permission Denied
**Symptom**: Can't access photos directory
**Solution**: 
```bash
sudo chown -R 1000:1000 /var/lib/photo-manager/projects/
sudo chmod -R 755 /var/lib/photo-manager/projects/
```

### Issue 3: Can't Access via Cloudflare
**Symptom**: Site not accessible
**Solution**:
- Check tunnel: `sudo systemctl status cloudflared`
- Check DNS propagation
- Verify ALLOWED_ORIGINS in docker-compose.yml

### Issue 4: Database Locked
**Symptom**: "database is locked" errors
**Solution**:
```bash
docker compose down
docker compose up -d
```

## Performance Optimization

### For Large Collections
```json
{
  "processing": {
    "workerCount": 8
  },
  "photo_grid": {
    "page_size": 500
  }
}
```

### For Limited Resources
```json
{
  "processing": {
    "workerCount": 2
  },
  "pipeline": {
    "max_parallel_jobs": 1
  }
}
```

## Future Enhancements

### Potential Improvements
1. Automated backup scripts with cron
2. Monitoring dashboard (Grafana + Prometheus)
3. Multiple storage backends
4. S3/cloud storage integration
5. High availability setup

### Not Implemented (Out of Scope)
- Automated backups (user responsibility)
- Monitoring stack (optional)
- Multi-node setup (single-host focus)
- Cloud storage sync (user choice)

## Documentation Quality

All documentation includes:
- ✅ Clear step-by-step instructions
- ✅ Code examples with explanations
- ✅ Troubleshooting sections
- ✅ Security considerations
- ✅ Performance tips
- ✅ Alternative configurations
- ✅ Quick reference commands
- ✅ Architecture diagrams

## Conclusion

Successfully created a complete Ubuntu + Cloudflare Tunnel deployment solution:

1. **Fixed Docker Compose Issue**: Documented correct V2 command
2. **Enabled Filesystem Access**: Bind mount for direct host access
3. **Created Setup Scripts**: Automated host preparation
4. **Comprehensive Documentation**: 3 detailed guides
5. **Security Hardened**: Proper permissions, no exposed ports
6. **Backup Ready**: Multiple backup strategies documented
7. **Production Ready**: Complete deployment guide

User can now:
- Deploy on Ubuntu with one script
- Access photos directly at `/var/lib/photo-manager/projects/`
- Use standard Linux tools (rsync, scp, etc.)
- Secure remote access via Cloudflare Tunnel
- Easy backups and maintenance

## References

- Docker Compose V2: https://docs.docker.com/compose/
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- Docker Volumes: https://docs.docker.com/storage/volumes/
- Docker Bind Mounts: https://docs.docker.com/storage/bind-mounts/
