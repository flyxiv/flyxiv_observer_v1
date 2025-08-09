# FlyXIV Observer Discord Bot

A Discord bot for FFXIV event reminders and information scraping.

## Features

- Automated Discord event reminders (30 minutes before start)
- FFXIV patch note summarization using Google Gemini AI
- Configurable notification channels and roles
- Timezone support (KST)

## Local Development

### Prerequisites

- Python 3.13+
- Discord Bot Token
- Google Gemini API Key

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd flyxiv_observer_v1
```

2. Install dependencies:
```bash
pip install -e .
```

3. Create a `.env` file:
```bash
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

4. Run the bot:
```bash
python -m pyobserver.main
```

## Deployment to Google Compute Engine

### Prerequisites

1. Google Cloud Project with Compute Engine API enabled
2. Service Account with Compute Engine permissions
3. VM instance running Ubuntu

### GitHub Secrets Setup

Add the following secrets to your GitHub repository:

- `GCP_PROJECT_ID`: Your Google Cloud Project ID
- `GCP_COMPUTE_ZONE`: VM zone (e.g., `us-central1-a`)
- `GCP_COMPUTE_INSTANCE`: VM instance name
- `GCP_SA_KEY`: Service account JSON key (base64 encoded)

### Automatic Deployment

The bot will automatically deploy to Google Compute Engine on every push to the `master` or `main` branch.

### Manual Deployment

1. Create a VM instance in Google Compute Engine
2. Run the startup script:
```bash
chmod +x scripts/startup.sh
./scripts/startup.sh
```

3. Install the systemd service:
```bash
sudo cp scripts/flyxiv-observer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable flyxiv-observer
sudo systemctl start flyxiv-observer
```

## Usage

### Discord Commands

- `!set_event_channel #channel [@role]` - Set default event notification channel
- `!set_event_role @role` - Set default mention role
- `!set_specific_event "event_name" #channel [@role]` - Set specific event settings
- `!show_event_settings` - Show current settings
- `!upcoming_events` - Show upcoming events
- `!event_info "event_name"` - Show specific event details
- `!summarize_patchnote 7.3` - Summarize patch notes
- `!healthcheck` - Check bot status

## Configuration

The bot uses `event_config.json` to store server-specific settings:

```json
{
  "server_id": {
    "notification_channel": "channel_id",
    "mention_role": "role_id",
    "event_settings": {
      "event_name": {
        "channel": "channel_id",
        "role": "role_id"
      }
    }
  }
}
```

## Logging

Logs are stored in `logs/bot.log` and rotated daily.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License 