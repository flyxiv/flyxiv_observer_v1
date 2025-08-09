#!/bin/bash

# FlyXIV Observer Discord Bot Startup Script
# This script sets up the environment and starts the Discord bot

set -e

# Navigate to the project directory
cd ~/flyxiv_observer

# Update system packages
sudo apt-get update

# Install Python 3.13 if not already installed
if ! command -v python3.13 &> /dev/null; then
    echo "Installing Python 3.13..."
    sudo apt-get install -y software-properties-common
    sudo add-apt-repository -y ppa:deadsnakes/ppa
    sudo apt-get update
    sudo apt-get install -y python3.13 python3.13-venv python3.13-dev
fi

# Install pip if not already installed
if ! command -v pip3 &> /dev/null; then
    echo "Installing pip..."
    sudo apt-get install -y python3-pip
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3.13 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
echo "Installing Python dependencies..."
pip install -e .

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file template..."
    cat > .env << EOF
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_token_here
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Additional configuration
# LOG_LEVEL=INFO
# DEBUG_MODE=false
EOF
    echo "⚠️  Please update the .env file with your actual Discord token and Gemini API key"
fi

# Set proper permissions
chmod 600 .env

# Create logs directory
mkdir -p logs

# Set up log rotation
if [ ! -f "/etc/logrotate.d/flyxiv-observer" ]; then
    sudo tee /etc/logrotate.d/flyxiv-observer > /dev/null << EOF
/home/$(whoami)/flyxiv_observer/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $(whoami) $(whoami)
}
EOF
fi

echo "✅ Startup script completed successfully!"
echo "The bot will be managed by systemd service: flyxiv-observer" 