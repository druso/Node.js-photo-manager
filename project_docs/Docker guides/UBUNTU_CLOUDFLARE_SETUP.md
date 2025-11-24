# Ubuntu + Cloudflare Tunnel Setup Guide

This guide explains how to deploy the Photo Manager on Ubuntu with Cloudflare Tunnel and direct filesystem access to your photos.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│ Ubuntu Host                                     │
│                                                 │
│  /var/lib/photo-manager/projects/              │
│  ├── project-name--p1/                         │
│  │   ├── originals/                            │
│  │   ├── thumbnails/                           │
│  │   └── previews/                             │
│  └── another-project--p2/                      │
│      └── ...                                    │
│                                                 │
│  ┌─────────────────────────────────┐           │
│  │ Docker Container                │           │
│  │  - App Code                     │           │
│  │  - /app/.projects → (bind mount)│───────────┤→ Direct access from host
│  │  - /app/.db → (Docker volume)   │           │
│  └─────────────────────────────────┘           │
│           ↓                                     │
│  ┌─────────────────────────────────┐           │
│  │ Cloudflare Tunnel               │           │
│  │  localhost:5000 → your-app.com  │           │
│  └─────────────────────────────────┘           │
└─────────────────────────────────────────────────┘
```

## Benefits of This Setup

✅ **Direct Filesystem Access**: Access photos directly at `/var/lib/photo-manager/projects/`
✅ **Use Standard Tools**: rsync, scp, rclone, or any file management tool
✅ **Easy Backups**: Standard filesystem backups work
✅ **Secure Remote Access**: Cloudflare Tunnel provides HTTPS without exposing ports
✅ **Data Separation**: Database in Docker volume, photos on host filesystem

## Prerequisites

- Ubuntu Server (20.04 LTS or newer)
- Docker and Docker Compose V2 installed
- Cloudflare account with a domain
- Root/sudo access

## Step 1: Install Docker (if not already installed)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (replace 'youruser' with your username)
sudo usermod -aG docker youruser

# Log out and back in for group changes to take effect

# Verify installation
docker --version
docker compose version
```

## Step 2: Prepare the Application

```bash
# Clone or copy your application to Ubuntu
cd /opt
sudo git clone <your-repo> photo-manager
cd photo-manager

# Or if copying from local machine:
# rsync -avz ~/code/Node.js\ photo\ manager/ ubuntu-server:/opt/photo-manager/
```

## Step 3: Setup Host Filesystem

```bash
# Run the setup script
sudo ./scripts/setup-ubuntu-host.sh
```

This creates:
- `/var/lib/photo-manager/projects/` - Your photos directory
- Proper permissions (1000:1000)
- Docker volume for database

**Alternative locations** (edit `docker-compose.yml` if you prefer):
- `/home/youruser/photos` - In your home directory
- `/mnt/photos` - On a separate drive/mount
- `/data/photos` - Custom data partition

## Step 4: Configure the Application

### 4.1 Update docker-compose.yml

```bash
cd /opt/photo-manager
nano docker-compose.yml
```

Verify the projects path matches your preference:
```yaml
volumes:
  - /var/lib/photo-manager/projects:/app/.projects
```

### 4.2 Set Environment Variables

```bash
# Generate secure secrets
export AUTH_ADMIN_BCRYPT_HASH="$(openssl rand -base64 32)"
export AUTH_JWT_SECRET_ACCESS="$(openssl rand -base64 32)"
export AUTH_JWT_SECRET_REFRESH="$(openssl rand -base64 32)"
export DOWNLOAD_SECRET="$(openssl rand -base64 32)"

# Save to .env file for persistence
cat > .env << EOF
AUTH_ADMIN_BCRYPT_HASH=${AUTH_ADMIN_BCRYPT_HASH}
AUTH_JWT_SECRET_ACCESS=${AUTH_JWT_SECRET_ACCESS}
AUTH_JWT_SECRET_REFRESH=${AUTH_JWT_SECRET_REFRESH}
DOWNLOAD_SECRET=${DOWNLOAD_SECRET}
EOF

chmod 600 .env
```

### 4.3 Configure config.json

```bash
cp config.default.json config.json
nano config.json
```

Adjust settings as needed (worker count, rate limits, etc.)

## Step 5: Install Cloudflare Tunnel

### 5.1 Install cloudflared

```bash
# Download and install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify installation
cloudflared --version
```

### 5.2 Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser - select your domain.

### 5.3 Create a Tunnel

```bash
# Create tunnel
cloudflared tunnel create photo-manager

# Note the tunnel ID from output
# Example: Created tunnel photo-manager with id: abc123-def456-ghi789
```

### 5.4 Configure the Tunnel

```bash
# Create config directory
sudo mkdir -p /etc/cloudflared

# Create tunnel config
sudo nano /etc/cloudflared/config.yml
```

Add this configuration:
```yaml
tunnel: photo-manager
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: photos.yourdomain.com
    service: http://localhost:5000
  - service: http_status:404
```

Replace:
- `<TUNNEL-ID>` with your actual tunnel ID
- `photos.yourdomain.com` with your desired subdomain

### 5.5 Create DNS Record

```bash
cloudflared tunnel route dns photo-manager photos.yourdomain.com
```

### 5.6 Install as System Service

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
sudo systemctl status cloudflared
```

## Step 6: Update Application CORS Settings

Edit `docker-compose.yml` to allow your Cloudflare domain:

```yaml
environment:
  ALLOWED_ORIGINS: https://photos.yourdomain.com
```

## Step 7: Start the Application

```bash
cd /opt/photo-manager

# Start in foreground (for testing)
docker compose up

# Or start in background
docker compose up -d

# View logs
docker compose logs -f
```

## Step 8: Verify Everything Works

### 8.1 Check Application

```bash
# Local access
curl http://localhost:5000/api/config

# Remote access (after DNS propagates)
curl https://photos.yourdomain.com/api/config
```

### 8.2 Check Filesystem Access

```bash
# List projects directory
ls -lah /var/lib/photo-manager/projects/

# Create a test project (the app will discover it)
sudo mkdir -p /var/lib/photo-manager/projects/test-project--p999/originals
sudo chown -R 1000:1000 /var/lib/photo-manager/projects/test-project--p999
```

### 8.3 Access the Web Interface

Open your browser: `https://photos.yourdomain.com`

## Accessing Photos from Ubuntu Host

### Direct Filesystem Access

```bash
# Navigate to projects
cd /var/lib/photo-manager/projects/

# List all projects
ls -lah

# View a specific project
cd project-name--p1/originals/
ls -lah
```

### Using Standard Tools

**rsync** (sync photos to/from server):
```bash
# Download photos from server
rsync -avz ubuntu-server:/var/lib/photo-manager/projects/ ./local-backup/

# Upload photos to server
rsync -avz ./my-photos/ ubuntu-server:/var/lib/photo-manager/projects/new-project--p1/originals/
```

**scp** (copy individual files):
```bash
scp ubuntu-server:/var/lib/photo-manager/projects/project-1/originals/photo.jpg ./
```

**rclone** (sync with cloud storage):
```bash
# Backup to cloud
rclone sync /var/lib/photo-manager/projects/ remote:photo-backups/
```

**Standard file managers**:
```bash
# Mount via SSHFS
sshfs ubuntu-server:/var/lib/photo-manager/projects/ ~/remote-photos/
```

## Backup Strategies

### 1. Filesystem Backup (Photos)

```bash
# Simple tar backup
sudo tar czf /backup/photos-$(date +%Y%m%d).tar.gz /var/lib/photo-manager/projects/

# Incremental rsync backup
rsync -avz --delete /var/lib/photo-manager/projects/ /backup/photos/
```

### 2. Database Backup

```bash
# Backup database volume
docker run --rm \
  -v photo-manager-db:/data \
  -v /backup:/backup \
  alpine tar czf /backup/db-$(date +%Y%m%d).tar.gz -C /data .
```

### 3. Automated Backups

Create `/etc/cron.daily/photo-manager-backup`:
```bash
#!/bin/bash
BACKUP_DIR="/backup/photo-manager"
DATE=$(date +%Y%m%d)

# Backup photos
rsync -avz --delete /var/lib/photo-manager/projects/ "$BACKUP_DIR/projects/"

# Backup database
docker run --rm \
  -v photo-manager-db:/data \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/db-$DATE.tar.gz" -C /data .

# Keep only last 30 days of database backups
find "$BACKUP_DIR" -name "db-*.tar.gz" -mtime +30 -delete
```

Make it executable:
```bash
sudo chmod +x /etc/cron.daily/photo-manager-backup
```

## Monitoring and Maintenance

### Check Application Status

```bash
# Container status
docker compose ps

# View logs
docker compose logs -f

# Check resource usage
docker stats
```

### Check Cloudflare Tunnel

```bash
# Tunnel status
sudo systemctl status cloudflared

# Tunnel logs
sudo journalctl -u cloudflared -f
```

### Disk Space Monitoring

```bash
# Check disk usage
df -h /var/lib/photo-manager/

# Check project sizes
du -sh /var/lib/photo-manager/projects/*
```

## Troubleshooting

### Permission Issues

```bash
# Fix ownership
sudo chown -R 1000:1000 /var/lib/photo-manager/projects/

# Fix permissions
sudo chmod -R 755 /var/lib/photo-manager/projects/
```

### Application Not Accessible

```bash
# Check if container is running
docker compose ps

# Check logs
docker compose logs -f

# Check if port is listening
sudo netstat -tlnp | grep 5000
```

### Cloudflare Tunnel Issues

```bash
# Check tunnel status
sudo systemctl status cloudflared

# Restart tunnel
sudo systemctl restart cloudflared

# Check tunnel logs
sudo journalctl -u cloudflared -n 100
```

### Database Issues

```bash
# Check database volume
docker volume inspect photo-manager-db

# Access database for debugging
docker run --rm -it \
  -v photo-manager-db:/data \
  alpine sh -c "ls -lah /data"
```

## Security Considerations

### Firewall Configuration

```bash
# Only allow SSH and Docker (Cloudflare Tunnel handles HTTPS)
sudo ufw allow 22/tcp
sudo ufw enable
```

**Note**: Don't open port 5000 - Cloudflare Tunnel handles external access securely.

### File Permissions

- Projects directory: `755` (read/execute for all, write for owner)
- Individual files: `644` (read for all, write for owner)
- Owner: `1000:1000` (matches Docker container user)

### Environment Variables

```bash
# Secure the .env file
chmod 600 /opt/photo-manager/.env
```

### Regular Updates

```bash
# Update application
cd /opt/photo-manager
git pull
docker compose down
docker compose up --build -d

# Update system
sudo apt update && sudo apt upgrade -y
```

## Advanced: Multiple Storage Locations

If you want photos on a different drive:

```bash
# Mount external drive
sudo mkdir -p /mnt/photos
sudo mount /dev/sdb1 /mnt/photos

# Update docker-compose.yml
volumes:
  - /mnt/photos:/app/.projects

# Add to /etc/fstab for auto-mount
echo "/dev/sdb1 /mnt/photos ext4 defaults 0 2" | sudo tee -a /etc/fstab
```

## Performance Optimization

### For Large Collections

Edit `config.json`:
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

## Useful Commands Reference

```bash
# Application Management
docker compose up -d              # Start application
docker compose down               # Stop application
docker compose restart            # Restart application
docker compose logs -f            # View logs
docker compose pull               # Update images

# Filesystem Access
cd /var/lib/photo-manager/projects/
ls -lah                           # List projects
du -sh *                          # Check sizes

# Backup
rsync -avz /var/lib/photo-manager/projects/ /backup/
docker run --rm -v photo-manager-db:/data -v /backup:/backup alpine tar czf /backup/db.tar.gz -C /data .

# Monitoring
docker stats                      # Resource usage
df -h                             # Disk space
sudo systemctl status cloudflared # Tunnel status
```

## Support and Documentation

- Application docs: See `README.md` and `project_docs/`
- Docker volumes: See `DOCKER_VOLUMES.md`
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/

---

**Quick Start Summary:**
1. Run `sudo ./scripts/setup-ubuntu-host.sh`
2. Configure Cloudflare Tunnel
3. Update `ALLOWED_ORIGINS` in `docker-compose.yml`
4. Run `docker compose up -d`
5. Access at `https://photos.yourdomain.com`
6. Photos accessible at `/var/lib/photo-manager/projects/`
