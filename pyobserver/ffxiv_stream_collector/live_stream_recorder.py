from datetime import datetime
import os
import subprocess
from discord.ext import commands
from pyobserver.ffxiv_stream_collector.dropbox import upload_to_dropbox
import discord.utils

class LiveStreamRecorder(commands.Cog):

    def __init__(self, result_channel_name):
        self.result_channel_name = result_channel_name

    @commands.command(name='record_stream')
    async def record_stream(self, ctx, channel_url, record_time=3600):
        result_channel = discord.utils.get(ctx.guild.text_channels, name=self.result_channel_name)

        if channel_url.startswith('https://www.twitch.tv/'):
            channel_name = channel_url.split('/')[-1]
        else:
            channel_name = get_channel_name_ytdlp(channel_url)['channel_name']

        os.makedirs(f'recordings/{channel_name}', exist_ok=True)
        output_file = f"recordings/{channel_name}/{datetime.now().strftime('%Y%m%d_%H%M%S')}.mkv"

        await ctx.send(f"Recording stream: {channel_url}")
        self.record_local(channel_url, output_file, record_time)

        await ctx.send(f"Saving output to Dropbox")
        public_url = upload_to_dropbox(output_file)


        await result_channel.send(f"--------------------------------------------------")
        await result_channel.send(f"New recording for {channel_url}")
        await result_channel.send(embed=discord.Embed(description=f"Timestamp: {output_file.split('/')[-1][:-4]}"))
        await result_channel.send(embed=discord.Embed(description=f"Download link: {public_url}"))
        await result_channel.send(f"--------------------------------------------------")

    def record_local(self, channel_url, output_file, record_time=3600):
        print(f"Testing recording to: {output_file}")
        
        # 방법 1: Streamlink 직접 사용
        cmd = [
            'streamlink',
            '--retry-streams', '3',
            '--retry-open', '3',
            channel_url,
            'best',
            '-o', output_file
        ]
        
        print(f"Running: {' '.join(cmd)}")
        process = subprocess.Popen(cmd)
        
        try:
            process.wait(timeout=record_time)
        except subprocess.TimeoutExpired:
            process.terminate()
            print(f"Recording stopped after {record_time} seconds")
        
        if os.path.exists(output_file):
            size = os.path.getsize(output_file) / (1024**2)
            print(f"File size: {size:.2f} MB")
        else:
            print("File not created!")

def get_channel_name_ytdlp(video_url):
    """
    yt-dlp를 사용해 YouTube 영상 정보 가져오기
    
    Args:
        video_url: YouTube 영상 URL
    
    Returns:
        채널 정보 딕셔너리
    """
    try:
        import yt_dlp
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            
            return {
                'channel_name': info.get('channel', 'Unknown'),
                'channel_id': info.get('channel_id', ''),
            }
            
    except ImportError:
        print("yt-dlp가 설치되지 않았습니다. pip install yt-dlp")
    except Exception as e:
        print(f"오류 발생: {e}")
    
    return None

async def setup(bot):
    await bot.add_cog(LiveStreamRecorder('스트림-raw'))
