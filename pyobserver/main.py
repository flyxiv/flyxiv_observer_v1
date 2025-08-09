import os
import sys
import logging
from dotenv import load_dotenv
import discord
from discord.ext import commands

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/bot.log'),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')

if not TOKEN:
    logger.error("DISCORD_TOKEN not found in environment variables!")
    sys.exit(1)

# Enable message content intent
intents = discord.Intents.default()
intents.message_content = True  

bot = commands.Bot(command_prefix='!', intents=intents)

@bot.event
async def on_ready():
    logger.info(f'{bot.user} has connected to Discord!')
    try:
        await bot.load_extension('pyobserver.ffxiv_info_scraper')
        logger.info("Loaded FFXIV Info Scraper extension")
    except Exception as e:
        logger.error(f"Failed to load FFXIV Info Scraper extension: {e}")
    
    try:
        await bot.load_extension('pyobserver.scheduled_event_reminder')
        logger.info("Loaded Scheduled Event Reminder extension")
    except Exception as e:
        logger.error(f"Failed to load Scheduled Event Reminder extension: {e}")

@bot.event
async def on_error(event, *args, **kwargs):
    logger.error(f"Error in event {event}: {args} {kwargs}")

def main():
    """Main function to run the bot"""
    try:
        logger.info("Starting FlyXIV Observer Discord bot...")
        bot.run(TOKEN)
    except discord.LoginFailure:
        logger.error("Failed to login: Invalid Discord token")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()