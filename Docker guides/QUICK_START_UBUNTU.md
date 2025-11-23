# Step-by-Step Guide: Ubuntu Home Server Setup

This guide will help you set up the Photo Manager on an Ubuntu computer connected to your home network. It covers everything from file setup to Cloudflare Tunnel and automatic updates.

**Goal:** A secure, reliable, self-updating photo manager accessible from anywhere.

---

## Prerequisites

Ensure your Ubuntu machine has the following installed:

### 1. Install Git
```bash
sudo apt update
sudo apt install git -y
```

### 2. Install Docker
```bash
# Add Docker's official GPG key
sudo apt install ca-certificates curl gnupg -y
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

# Add your user to docker group (logout/login required after this)
sudo usermod -aG docker $USER
```

**Important:** After adding yourself to the docker group, log out and log back in for the changes to take effect.

### 3. Verify Docker Installation
```bash
docker --version
docker compose version
```

---

## Step 1: Get the App Code

Choose a folder for your application code. We'll use `~/photo-manager` in this example.

**Replace `<YOUR_REPO_URL>` with your actual Git repository URL.**

```bash
cd ~
git clone <YOUR_REPO_URL> photo-manager
cd photo-manager
```

**Verify:**
```bash
ls -la
# You should see files like docker-compose.yml, Dockerfile, etc.
```

---

## Step 2: Prepare the Host System

We need to create specific folders for your photos and database to ensure they persist and are accessible.

> [!IMPORTANT]
> **Why is this step necessary?** If we skip this and let Docker create the directories automatically, Docker will create them as `root:root` with restrictive permissions. This would prevent:
> - The app (running as user 1000) from writing to the directories
> - You from accessing your photos through the file manager
> - Proper backups and file management

### Run the Setup Script

```bash
chmod +x setup-ubuntu-host.sh
sudo ./setup-ubuntu-host.sh
```

**What this does:**
- Creates `/var/lib/photo-manager/projects` (where your photos live)
- Creates `/var/lib/photo-manager/db` (where the database is stored)
- Sets permissions so your user (ID 1000) can access files

### Verify

Check that you can access both folders:
```bash
ls -ld /var/lib/photo-manager/projects
ls -ld /var/lib/photo-manager/db
```

You should see both directories owned by `1000:1000` with `755` permissions.

---

## Step 3: Secure Configuration

We need to set up secret keys for security. **Do not skip this.**

### Create the `.env` File

```bash
cp .env.example .env
nano .env
```

### Generate Secure Secrets

You need to generate 4 secure values:

#### 1. Generate JWT Secrets (3 needed)

Run this command **3 times** and save each output:
```bash
openssl rand -base64 32
```

Use these values for:
- `AUTH_JWT_SECRET_ACCESS`
- `AUTH_JWT_SECRET_REFRESH`
- `DOWNLOAD_SECRET`

#### 2. Generate Admin Password Hash

First, decide on your admin password (e.g., `MySecurePassword123!`).

Then generate a bcrypt hash using Node.js:
```bash
docker run --rm -it node:18-alpine sh -c "npm install -g bcrypt && node -e \"require('bcrypt').hash('MySecurePassword123!', 12).then(console.log)\""
```

**Replace `MySecurePassword123!` with your actual desired password.**

Copy the output hash (starts with `$2b$12$...`) and use it for `AUTH_ADMIN_BCRYPT_HASH`.

### Your `.env` File Should Look Like This

**Replace the placeholder values with your actual secrets and domain:**

```env
# Authentication
AUTH_ADMIN_BCRYPT_HASH="$2b$12$YOUR_GENERATED_HASH_HERE"
AUTH_JWT_SECRET_ACCESS="YOUR_FIRST_RANDOM_STRING"
AUTH_JWT_SECRET_REFRESH="YOUR_SECOND_RANDOM_STRING"
AUTH_BCRYPT_COST="12"

# CORS Configuration
# Set this to your production domain (e.g., https://foto.dru.so)
ALLOWED_ORIGINS="https://your-domain.com"

# Download Security
DOWNLOAD_SECRET="YOUR_THIRD_RANDOM_STRING"
```

### Configure `config.json`

```bash
cp config.default.json config.json
```

You can edit `config.json` later to change app settings like upload limits, allowed file types, etc.

---

## Step 4: Setup Cloudflare Tunnel

This exposes your app securely to the internet without opening router ports.

### Install Cloudflared

```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

### Login to Cloudflare

```bash
cloudflared tunnel login
```

Follow the link in your terminal to authorize cloudflared with your Cloudflare account.

### Create the Tunnel

```bash
cloudflared tunnel create photo-manager
```

**Important:** Copy the Tunnel UUID that is displayed (looks like `12345678-1234-1234-1234-123456789abc`).

### Configure the Tunnel

Create a config file:
```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Paste this content (replace `<TUNNEL_UUID>` with your actual UUID and `photos.yourdomain.com` with your domain):

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: photos.yourdomain.com
    service: http://localhost:5000
  - service: http_status:404
```

**Note:** When running as a service with `sudo`, the credentials file is in `/root/.cloudflared/`, not your home directory.

### Route DNS

```bash
cloudflared tunnel route dns photo-manager photos.yourdomain.com
```

This creates a CNAME record in your Cloudflare DNS pointing to the tunnel.

### Install as a System Service

This ensures the tunnel starts automatically on reboot:
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### Verify Tunnel is Running

```bash
sudo systemctl status cloudflared
```

You should see `active (running)` in green.

---

## Step 5: Start the Application

Now we build and run the Docker container.

```bash
docker compose up -d --build
```

### Verify the App is Running

```bash
docker compose ps
```

You should see the `photo-manager` container with status `Up` and `healthy`.

### View Logs

```bash
docker compose logs -f
```

Press `Ctrl+C` to exit the logs.

---

## Step 6: Setup Auto-Updates

To ensure your app stays updated when you push changes to Git, we'll use a cron job.

### Make the Update Script Executable

```bash
chmod +x auto_update.sh
```

### Test the Script

```bash
./auto_update.sh
```

You should see output like:
```
Checking for updates: ...
Current branch: main
App is up to date.
```

### Add to Crontab

Open crontab:
```bash
crontab -e
```

Add this line to check for updates every hour (replace `<YOUR_USERNAME>` with your actual username):
```bash
0 * * * * /home/<YOUR_USERNAME>/photo-manager/auto_update.sh >> /home/<YOUR_USERNAME>/photo-manager/update.log 2>&1
```

**Example:** If your username is `john`, the line would be:
```bash
0 * * * * /home/john/photo-manager/auto_update.sh >> /home/john/photo-manager/update.log 2>&1
```

### Verify Crontab

```bash
crontab -l
```

You should see your new cron job listed.

---

## Step 7: Accessing Your Files

Your photos and project files are stored in `/var/lib/photo-manager/projects`.

### Add Existing Photos

Simply copy folders into this directory:
```bash
sudo cp -r ~/my-old-photos /var/lib/photo-manager/projects/
sudo chown -R 1000:1000 /var/lib/photo-manager/projects/my-old-photos
```

### Access Photos from File Manager

Open your file manager and navigate to `/var/lib/photo-manager/projects/`.

### Backup Your Data

Copy the contents to an external drive or cloud storage:
```bash
rsync -avz /var/lib/photo-manager/projects/ /path/to/backup/
rsync -avz /var/lib/photo-manager/db/ /path/to/backup/db/
```

---

## Step 8: Access Your Application

Open your browser and go to:
```
https://photos.yourdomain.com
```

You should see the Photo Manager login page.

**Login with:**
- Username: `admin`
- Password: The password you used to generate the bcrypt hash in Step 3

---

## Common Commands

### View Application Logs
```bash
docker compose logs -f
```

### Restart the Application
```bash
docker compose restart
```

### Stop the Application
```bash
docker compose down
```

### Manually Update the Application
```bash
cd ~/photo-manager
git pull
docker compose up -d --build
```

### Check Auto-Update Logs
```bash
tail -f ~/photo-manager/update.log
```

---

## Troubleshooting

### Docker Compose Command Not Found

Make sure you're using `docker compose` (with a space), not `docker-compose` (with a hyphen). The hyphen version is the old standalone tool.

```bash
docker compose up -d  # ✓ Correct (Docker Compose V2)
docker-compose up -d  # ✗ Old version
```

### Permission Denied Errors

If you get permission errors when running Docker commands:
```bash
# Make sure you're in the docker group
groups
# If 'docker' is not listed, add yourself and logout/login
sudo usermod -aG docker $USER
```

### Can't Access the Application

1. **Check the tunnel:**
   ```bash
   sudo systemctl status cloudflared
   ```

2. **Check the app:**
   ```bash
   docker compose ps
   docker compose logs
   ```

3. **Check CORS settings:**
   Make sure `ALLOWED_ORIGINS` in `docker-compose.yml` matches your domain.

### Database or Photos Not Persisting

Check that the directories exist and have correct permissions:
```bash
ls -ld /var/lib/photo-manager/projects
ls -ld /var/lib/photo-manager/db
# Both should be owned by 1000:1000
```

If not, run:
```bash
sudo chown -R 1000:1000 /var/lib/photo-manager/projects
sudo chown -R 1000:1000 /var/lib/photo-manager/db
```

### Auto-Update Not Working

Check the cron log:
```bash
tail -f ~/photo-manager/update.log
```

Make sure the script is executable:
```bash
chmod +x ~/photo-manager/auto_update.sh
```

---

## Security & Reliability Features

✅ **Docker Restart Policy**: The app is set to `restart: unless-stopped`, so it recovers from crashes and reboots.

✅ **Cloudflare Service**: The tunnel runs as a system service, ensuring connectivity after reboots.

✅ **Auto-Update**: The cron job keeps your code in sync with the repository.

✅ **Persistent Data**: All data is stored in `/var/lib/photo-manager`, safe from container resets.

✅ **Secure Secrets**: All authentication uses strong, randomly generated secrets.

✅ **No Port Forwarding**: Cloudflare Tunnel eliminates the need to expose ports on your router.

---

## Summary

You now have a fully functional, secure, and self-updating photo manager running on your Ubuntu home server! 🎉

- **Access:** https://photos.yourdomain.com
- **Photos:** `/var/lib/photo-manager/projects/`
- **Database:** `/var/lib/photo-manager/db/`
- **Logs:** `docker compose logs -f`
- **Update Logs:** `~/photo-manager/update.log`
