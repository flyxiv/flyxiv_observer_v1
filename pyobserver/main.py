import os
from dotenv import load_dotenv
from pyobserver.ffxiv_info_scraper import FFXIVInfoScraper
from pyobserver.scheduled_event_reminder import ScheduledEventReminder
import discord
from discord.ext import commands

load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')

# Enable message content intent
intents = discord.Intents.default()
intents.message_content = True  

bot = commands.Bot(command_prefix='!', intents=intents)

async def setup(bot):
    await bot.add_cog(FFXIVInfoScraper(bot))

@bot.event
async def on_ready():
    print(f'{bot.user} has connected to Discord!')
    await bot.load_extension('pyobserver.ffxiv_info_scraper')
    await bot.load_extension('pyobserver.scheduled_event_reminder')


bot.run(TOKEN)