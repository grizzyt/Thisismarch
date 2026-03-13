#!/bin/bash
# Run this on the DigitalOcean droplet as root after cloning the repo
set -e

echo "=== Installing system packages ==="
apt-get update -y
apt-get install -y python3 python3-pip python3-venv nginx nodejs npm

echo "=== Setting up backend ==="
cd /opt/madnesslab/backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt

echo "=== Building frontend ==="
cd /opt/madnesslab/frontend
npm install
npm run build

echo "=== Configuring nginx ==="
cp /opt/madnesslab/deploy/nginx.conf /etc/nginx/sites-available/madnesslab
ln -sf /etc/nginx/sites-available/madnesslab /etc/nginx/sites-enabled/madnesslab
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Setting up systemd service ==="
cp /opt/madnesslab/deploy/madnesslab.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable madnesslab
systemctl start madnesslab

echo "=== Done! ==="
echo "Check status: systemctl status madnesslab"
echo "Check logs:   journalctl -u madnesslab -f"
