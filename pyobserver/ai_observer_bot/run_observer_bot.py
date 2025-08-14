import os
import sys
import logging
from dotenv import load_dotenv
import discord
from discord.ext import commands

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
TOKEN = os.getenv('AI_ASSISTANT_DISCORD_TOKEN')

if not TOKEN:
    logger.error("DISCORD_TOKEN not found in environment variables!")
    sys.exit(1)

# Enable message content intent
intents = discord.Intents.default()
intents.message_content = True  

bot = commands.Bot(command_prefix='!!', intents=intents)

@bot.event
async def on_ready():
    logger.info(f'{bot.user} has connected to Discord!')
    try:
        await bot.load_extension('pyobserver.ai_observer_bot.discussion_summarizer')
        await bot.load_extension('pyobserver.ffxiv_stream_collector.live_stream_recorder')
    except Exception as e:
        logger.error(f"Failed to load Discussion Summarizer extension: {e}")

@bot.event
async def on_error(event, *args, **kwargs):
    logger.error(f"Error in event {event}: {args} {kwargs}")

@bot.command()
@commands.is_owner()  # 봇 소유자만 실행 가능
async def update(ctx):
    """Git에서 최신 코드를 가져옵니다"""
    await ctx.send("📥 업데이트를 확인하는 중...")
    
    try:
        # Git pull 실행
        process = await asyncio.create_subprocess_shell(
            'git pull origin main',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        # 결과 확인
        if process.returncode == 0:
            output = stdout.decode()
            if "Already up to date." in output:
                await ctx.send("✅ 이미 최신 버전입니다!")
            else:
                await ctx.send(f"✅ 업데이트 완료!\n```\n{output}\n```")
                await ctx.send("🔄 봇을 재시작합니다...")
                await bot.close()
                # 봇 재시작
                os.execv(sys.executable, ['python'] + sys.argv)
        else:
            await ctx.send(f"❌ 업데이트 실패:\n```\n{stderr.decode()}\n```")
            
    except Exception as e:
        await ctx.send(f"❌ 오류 발생: {str(e)}")

@bot.command()
async def healthcheck(ctx):
    """봇의 상태를 확인합니다"""
    # 디버깅: 봇의 권한 상태 출력
    print(f"봇 권한 - 관리자: {ctx.guild.me.guild_permissions.administrator}")
    print(f"봇 최상위 역할: {ctx.guild.me.top_role.name}")

    await ctx.send("✅ 봇이 정상 작동 중입니다!")

def main():
    """Main function to run the bot"""
    try:
        logger.info("Starting FlyXIV AI Observer Discord bot...")
        bot.run(TOKEN)
    except discord.LoginFailure:
        logger.error("Failed to login: Invalid Discord token")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()