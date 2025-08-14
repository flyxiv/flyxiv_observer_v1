import discord
from discord.ext import commands, tasks
from datetime import datetime, timedelta
import pytz
import json
import os
from pyobserver.request_gemini import request_gemini, GeminiModels
from typing import Dict, List, Set, Optional
from pyobserver.ai_observer_bot.summarization_prompt import summarization_prompt

KST = pytz.timezone('Asia/Seoul')


class DiscussionSummarizer(commands.Cog):
    """Discord `input_channel-논의` 채널에서 논의한 내용 중 논의 중인 내용을 필터링 하고 "최종적으로 결정된 사안" 들만 LLM으로 요약하여 `input_channel-최종정리` 채널로 전송"""
    
    def __init__(self, bot):
        self.bot = bot
        
        # key: channel name, value: list of messages
        self.conversation_history: Dict[str, List[Dict]] = {}
        
        # 처리된 메시지 ID 추적 (채널별로 중복 처리 방지)
        self.processed_message_ids: Dict[str, Set[int]] = {}
        
        # 채널 매핑 정보 (논의 채널 -> 정리 채널)
        self.channel_mappings: Dict[str, str] = {}
        
        # 설정 파일
        self.config_file = 'discussion_config.json'
        self.history_file = 'conversation_history.json'
        
        # 설정 및 기록 로드
        self.load_config()
        self.load_history()
    
    def load_config(self):
        """설정 파일 로드"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.channel_mappings = data.get('channel_mappings', {})
            except Exception as e:
                print(f"설정 파일 로드 실패: {e}")
    
    def save_config(self):
        """설정 파일 저장"""
        try:
            data = {
                'channel_mappings': self.channel_mappings
            }
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"설정 파일 저장 실패: {e}")
    
    def load_history(self):
        """대화 기록 로드"""
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.conversation_history = data.get('history', {})
                    # 처리된 메시지 ID 복원
                    self.processed_message_ids = {
                        channel: set(ids) for channel, ids in data.get('processed_ids', {}).items()
                    }
            except Exception as e:
                print(f"대화 기록 로드 실패: {e}")
    
    def save_history(self):
        """대화 기록 저장"""
        try:
            data = {
                'history': self.conversation_history,
                'processed_ids': {
                    channel: list(ids) for channel, ids in self.processed_message_ids.items()
                }
            }
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"대화 기록 저장 실패: {e}")
    
    def cog_unload(self):
        """Cog 언로드 시 저장"""
        self.save_config()
        self.save_history()

    @commands.command(name='register_channel', aliases=['채널등록'])
    async def register_channel(self, ctx, channel_name: str):
        """Add conversation history of the given channel and add all the messages in the channel to the conversation history"""
        
        # 논의 채널과 정리 채널 찾기
        discussion_channel_name = f"{channel_name}-논의"
        summary_channel_name = f"{channel_name}-최종정리"
        
        discussion_channel = discord.utils.get(ctx.guild.text_channels, name=discussion_channel_name)
        summary_channel = discord.utils.get(ctx.guild.text_channels, name=summary_channel_name)
        
        if not discussion_channel:
            await ctx.send(f"❌ '{discussion_channel_name}' 채널을 찾을 수 없습니다.")
            return
        
        if not summary_channel:
            await ctx.send(f"❌ '{summary_channel_name}' 채널을 찾을 수 없습니다.")
            return
        
        # 채널 매핑 등록
        self.channel_mappings[discussion_channel_name] = summary_channel_name
        
        # 대화 기록 초기화
        if discussion_channel_name not in self.conversation_history:
            self.conversation_history[discussion_channel_name] = []
            self.processed_message_ids[discussion_channel_name] = set()
        
        # 기존 메시지 로드
        try:
            message_count = 0
            async for message in discussion_channel.history(limit=1000):  # 최근 1000개 메시지
                if not message.author.bot:  # 봇 메시지 제외
                    message_data = {
                        'id': message.id,
                        'author': message.author.name,
                        'content': message.content,
                        'timestamp': message.created_at.isoformat(),
                        'attachments': [att.url for att in message.attachments]
                    }
                    
                    # 중복 확인
                    if message.id not in self.processed_message_ids[discussion_channel_name]:
                        self.conversation_history[discussion_channel_name].append(message_data)
                        self.processed_message_ids[discussion_channel_name].add(message.id)
                        message_count += 1
            
            # 시간순 정렬 (오래된 것부터)
            self.conversation_history[discussion_channel_name].sort(key=lambda x: x['timestamp'])
            
            # 설정 저장
            self.save_config()
            self.save_history()
            
            embed = discord.Embed(
                title="✅ 채널 등록 완료",
                description=f"'{channel_name}' 채널이 등록되었습니다.",
                color=discord.Color.green()
            )
            embed.add_field(name="논의 채널", value=discussion_channel.mention, inline=True)
            embed.add_field(name="정리 채널", value=summary_channel.mention, inline=True)
            embed.add_field(name="로드된 메시지", value=f"{message_count}개", inline=True)
            
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"❌ 메시지 로드 중 오류 발생: {e}")
    
    @commands.command(name='summarize_discussion_result', aliases=['논의결과요약', '요약'])
    async def summarize_discussion_result(self, ctx, channel_name: str):
        """Read new messages(messages not yet in the conversation history) in the given channel, collect only the things that are decided, and write the summary to the final summary channel"""
        
        discussion_channel_name = f"{channel_name}-논의"
        summary_channel_name = f"{channel_name}-최종정리"
        
        # 채널 확인
        if discussion_channel_name not in self.channel_mappings:
            await ctx.send(f"❌ '{channel_name}' 채널이 등록되지 않았습니다. 먼저 `!register_channel {channel_name}`을 실행하세요.")
            return
        
        discussion_channel = discord.utils.get(ctx.guild.text_channels, name=discussion_channel_name)
        summary_channel = discord.utils.get(ctx.guild.text_channels, name=summary_channel_name)

        summary_channel_messages = []
        async for message in summary_channel.history(limit=1000):
            if message.content:
                summary_channel_messages.append(message.content)

            if message.embeds:
                for embed in message.embeds:
                    embed_content = []
                    
                    # 임베드 제목
                    if embed.title:
                        embed_content.append(f"📋 {embed.title}")
                    
                    # 임베드 설명
                    if embed.description:
                        embed_content.append(embed.description)
                    
                    if embed_content:
                        summary_channel_messages.append('\n'.join(embed_content))
        summary_channel_messages.reverse()


        discussion_channel_messages = []
        async for message in discussion_channel.history(limit=1000):
            discussion_channel_messages.append(message.content)
        discussion_channel_messages.reverse()
            
        if not discussion_channel or not summary_channel:
            await ctx.send("❌ 채널을 찾을 수 없습니다.")
            return
        
        # 처리 중 메시지
        processing_msg = await ctx.send("⏳ 새로운 메시지를 읽고 결정사항을 분석 중...")
        
        try:
            # 새 메시지 수집
            new_messages = []
            async for message in discussion_channel.history(limit=500):
                if not message.author.bot and message.id not in self.processed_message_ids.get(discussion_channel_name, set()):
                    message_data = {
                        'id': message.id,
                        'author': message.author.name,
                        'content': message.content,
                        'timestamp': message.created_at.isoformat(),
                        'attachments': [att.url for att in message.attachments]
                    }
                    new_messages.append(message_data)
                    
           
            if not new_messages:
                await processing_msg.edit(content="ℹ️ 새로운 메시지가 없습니다.")
                return
            
            # 시간순 정렬
            new_messages.sort(key=lambda x: x['timestamp'])
            
            # LLM 프롬프트 생성
            conversation_text = "\n".join([
                f"[{msg['timestamp']}] {msg['author']}: {msg['content']}" 
                for msg in new_messages
            ])

            prompt = summarization_prompt(discussion_channel_messages, summary_channel_messages)
            print(prompt)
            # Gemini API 호출
            await processing_msg.edit(content="🤖 AI가 결정사항을 분석 중...")
            summary = request_gemini(GeminiModels.GEMINI_2_5_PRO, prompt)
            
            if summary and "아직 최종 결정된 사항이 없습니다" not in summary:
                if len(summary) > 2000:
                    chunks = [summary[i:i+2000] for i in range(0, len(summary), 2000)]
                    for i, chunk in enumerate(chunks):
                        if i == 0:
                            embed = discord.Embed(
                                title=f"📊 {channel_name} 논의 결과 요약",
                                description=chunk,
                                color=discord.Color.blue(),
                                timestamp=datetime.now(KST)
                            )
                            embed.set_footer(text=f"요약 요청자: {ctx.author.name}")
                            await summary_channel.send(embed=embed)
                        else:
                            await summary_channel.send(chunk)
                else:
                    embed = discord.Embed(
                        title=f"📊 {channel_name} 논의 결과 요약",
                        description=summary,
                        color=discord.Color.blue(),
                        timestamp=datetime.now(KST)
                    )
                    
                    await summary_channel.send(embed=embed)
                
                await processing_msg.edit(content=f"✅ 요약이 완료되어 {summary_channel.mention}에 게시되었습니다.")
            else:
                await processing_msg.edit(content="ℹ️ 아직 최종 결정된 사항이 없습니다.")
            
            # 기록 저장
            self.save_history()
            
        except Exception as e:
            print(f"요약 오류: {e}")
        
        # 대화 기록에 추가
        self.conversation_history[discussion_channel_name].append(message_data)
        self.processed_message_ids[discussion_channel_name].add(message.id)
 
    
    @commands.command(name='clear_history', aliases=['기록초기화'])
    @commands.has_permissions(manage_guild=True)
    async def clear_history(self, ctx, channel_name: str):
        """특정 채널의 대화 기록 초기화"""
        discussion_channel_name = f"{channel_name}-논의"
        
        if discussion_channel_name in self.conversation_history:
            self.conversation_history[discussion_channel_name] = []
            self.processed_message_ids[discussion_channel_name] = set()
            self.save_history()
            await ctx.send(f"✅ '{channel_name}' 채널의 대화 기록이 초기화되었습니다.")
        else:
            await ctx.send(f"❌ '{channel_name}' 채널이 등록되지 않았습니다.")

    @commands.command(name='show_history', aliases=['기록보기'])
    async def show_history(self, ctx, channel_name: str):
        """특정 채널의 대화 기록 표시"""
        discussion_channel_name = f"{channel_name}"
        if discussion_channel_name in self.conversation_history:
            await ctx.send(f"'{channel_name}' 채널의 대화 기록 메모리: ")
            await ctx.send(f"{self.conversation_history[discussion_channel_name]}")
        else:
            await ctx.send(f"❌ '{channel_name}' 채널이 등록되지 않았습니다.")

    @commands.command(name='show_history_all', aliases=['모든기록보기'])
    async def show_history_all(self, ctx):
        """모든 채널의 대화 기록 표시"""
        for channel_name in self.conversation_history:
            await self.show_history(ctx, channel_name)
 
    
    @commands.command(name='show_stats', aliases=['통계'])
    async def show_stats(self, ctx):
        """등록된 채널들의 통계 표시"""
        if not self.channel_mappings:
            await ctx.send("등록된 채널이 없습니다.")
            return
        
        embed = discord.Embed(
            title="📊 논의 채널 통계",
            color=discord.Color.blue(),
            timestamp=datetime.now(KST)
        )
        
        for discussion_channel, summary_channel in self.channel_mappings.items():
            channel_name = discussion_channel.replace("-논의", "")
            message_count = len(self.conversation_history.get(discussion_channel, []))
            processed_count = len(self.processed_message_ids.get(discussion_channel, set()))
            
            embed.add_field(
                name=channel_name,
                value=f"메시지: {message_count}개\n처리됨: {processed_count}개",
                inline=True
            )
        
        await ctx.send(embed=embed)


# Cog 설정
async def setup(bot):
    await bot.add_cog(DiscussionSummarizer(bot))