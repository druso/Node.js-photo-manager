# Quick Start: Ubuntu + Cloudflare Tunnel

## 🚀 5-Minute Setup

### 1. Prepare Host
```bash
sudo ./setup-ubuntu-host.sh
```

### 2. Configure Application
```bash
# Set secrets
cat > .env << EOF
AUTH_ADMIN_BCRYPT_HASH=$(openssl rand -base64 32)
AUTH_JWT_SECRET_ACCESS=$(openssl rand -base64 32)
AUTH_JWT_SECRET_REFRESH=$(openssl rand -base64 32)
DOWNLOAD_SECRET=$(openssl rand -base64 32)
EOF

# Copy config
cp config.default.json config.json
```

### 3. Setup Cloudflare Tunnel
```bash
# Install
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create photo-manager

# Configure (edit with your tunnel ID and domain)
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

**config.yml:**
```yaml
tunnel: photo-manager
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: photos.yourdomain.com
    service: http://localhost:5000
  - service: http_status:404
```

```bash
# Route DNS
cloudflared tunnel route dns photo-manager photos.yourdomain.com

# Install service
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### 4. Update CORS
Edit `docker-compose.yml`:
```yaml
environment:
  ALLOWED_ORIGINS: https://photos.yourdomain.com
```

### 5. Start Application
```bash
docker compose up -d
```

### 6. Access
- **Web**: https://photos.yourdomain.com
- **Photos**: `/var/lib/photo-manager/projects/`

## 📁 File Access

```bash
# Navigate to photos
cd /var/lib/photo-manager/projects/

# Copy photos to server
rsync -avz ./my-photos/ ubuntu:/var/lib/photo-manager/projects/new-project--p1/originals/

# Download from server
rsync -avz ubuntu:/var/lib/photo-manager/projects/ ./backup/
```

## 🔧 Common Commands

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Update
git pull && docker compose up --build -d

# Backup
rsync -avz /var/lib/photo-manager/projects/ /backup/
```

## 🆘 Troubleshooting

**Docker Compose Error?**
```bash
# Use space, not hyphen
docker compose up -d  # ✓ Correct
docker-compose up -d  # ✗ Old version
```

**Permission Issues?**
```bash
sudo chown -R 1000:1000 /var/lib/photo-manager/projects/
```

**Can't Access?**
```bash
# Check tunnel
sudo systemctl status cloudflared

# Check app
docker compose ps
docker compose logs
```

## 📚 Full Documentation

- Complete guide: `UBUNTU_CLOUDFLARE_SETUP.md`
- Volume management: `DOCKER_VOLUMES.md`
- Application docs: `README.md`
