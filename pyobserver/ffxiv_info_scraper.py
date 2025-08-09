from discord.ext import commands
import discord
from pyobserver.request_gemini import request_gemini, GeminiModels
import requests
from bs4 import BeautifulSoup
import asyncio

def scrape_webpage(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, 'html.parser')
    
    text = soup.get_text(strip=True)
    return text

patch_note_urls = {
    '7.3': 'https://na.finalfantasyxiv.com/lodestone/topics/detail/c04405c6cbe8519a0b6c8aa5e4d88a5d447419c9'
}

CHUNK_SIZE = 1500 


class FFXIVInfoScraper(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name='summarize_patchnote', aliases=['패치요약'])
    async def summarize_patchnote(self, ctx, patch_version: str):
        await ctx.send(f"Scraping patch note for {patch_version}...")
        webpage_content = scrape_webpage(patch_note_urls[patch_version])

        prompt = f"""
        You are a helpful assistant that summarizes patchnotes.
        You will be given a patch note url.
        You will need to summarize the patchnote.

        The scraped patch note page is: {webpage_content}

        I am a hardcore raider so I'm only interested in the battle content and balance changes in PVE.
        Create a discord markdown document with the job changes with the exact number changes and content updates summarized. 
        """


        await ctx.send(f"Summarizing patch note for {patch_version}...")
        response = request_gemini(GeminiModels.GEMINI_2_5_FLASH, prompt)

        text = response.text
        print(text)

        if len(text) > CHUNK_SIZE:
            for i in range(0, len(text), CHUNK_SIZE):
                chunk = text[i:i+CHUNK_SIZE]
                await ctx.send(chunk)
                await asyncio.sleep(1)
        else:
            await ctx.send(text)
    
    @commands.command(name='healthcheck')
    async def healthcheck(self, ctx):
        await ctx.send('Live and ready!')


async def setup(bot):
    await bot.add_cog(FFXIVInfoScraper(bot))