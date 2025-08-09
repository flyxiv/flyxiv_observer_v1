import discord
from discord.ext import commands, tasks
from datetime import datetime, timedelta
import pytz
import json
import os

# 한국 시간대 설정
KST = pytz.timezone('Asia/Seoul')

class ScheduledEventReminder(commands.Cog):
    """Discord 예정된 이벤트 알림 봇"""
    
    def __init__(self, bot):
        self.bot = bot
        self.notified_events_1day = set()  
        self.config_file = 'event_config.json'
        self.config = self.load_config()
        self.check_scheduled_events.start()
    
    def load_config(self):
        """설정 파일 로드"""
        if os.path.exists(self.config_file):
            with open(self.config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def save_config(self):
        """설정 파일 저장"""
        with open(self.config_file, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, ensure_ascii=False, indent=2)
    
    def cog_unload(self):
        self.check_scheduled_events.cancel()
        self.save_config()
    
    def get_guild_config(self, guild_id):
        """서버별 설정 가져오기"""
        return self.config.get(str(guild_id), {
            'notification_channel': None,
            'mention_role': None,
            'event_settings': {}
        })
    
    def set_guild_config(self, guild_id, channel_id=None, role_id=None):
        """서버별 설정 저장"""
        guild_id = str(guild_id)
        if guild_id not in self.config:
            self.config[guild_id] = {
                'notification_channel': None,
                'mention_role': None,
                'event_settings': {}
            }
        
        if channel_id is not None:
            self.config[guild_id]['notification_channel'] = channel_id
        if role_id is not None:
            self.config[guild_id]['mention_role'] = role_id
        
        self.save_config()
    
    def set_event_config(self, guild_id, event_name, channel_id=None, role_id=None):
        """특정 이벤트별 설정"""
        guild_id = str(guild_id)
        if guild_id not in self.config:
            self.config[guild_id] = {
                'notification_channel': None,
                'mention_role': None,
                'event_settings': {}
            }
        
        event_key = event_name.lower()
        if event_key not in self.config[guild_id]['event_settings']:
            self.config[guild_id]['event_settings'][event_key] = {}
        
        if channel_id is not None:
            self.config[guild_id]['event_settings'][event_key]['channel'] = channel_id
        if role_id is not None:
            self.config[guild_id]['event_settings'][event_key]['role'] = role_id
        
        self.save_config()
    
    @tasks.loop(minutes=15)  
    async def check_scheduled_events(self):
        """Discord의 예정된 이벤트를 확인하고 30분 전에 알림을 보냅니다."""
        current_time = datetime.now(KST)
        
        for guild in self.bot.guilds:
            try:
                # 서버의 모든 예정된 이벤트 가져오기
                events = await guild.fetch_scheduled_events()
                
                for event in events:
                    # 이벤트가 예정됨 상태인지 확인
                    if event.status == discord.EventStatus.scheduled:
                        # 이벤트 시작 시간 (UTC를 KST로 변환)
                        event_time = event.start_time.replace(tzinfo=pytz.UTC).astimezone(KST)
                        
                        # 현재 시간과의 차이 계산
                        time_until_event = event_time - current_time

                        if timedelta(days=0) <= time_until_event <= timedelta(days=1):
                            if event.id not in self.notified_events_1day:
                                self.notified_events_1day.add(event.id)
                                await self.send_event_reminder(event, guild, time_until_event, one_day_alarm=True)

                        if timedelta(minutes=0) <= time_until_event <= timedelta(minutes=30):
                            await self.send_event_reminder(event, guild, time_until_event)
                    
                        # 이벤트가 지났으면 알림 목록에서 제거
                        elif time_until_event <= timedelta(minutes=0):
                            self.notified_events_1day.discard(event.id)
                            
            except Exception as e:
                print(f"서버 {guild.name}에서 이벤트 확인 중 오류: {e}")
    
    @check_scheduled_events.before_loop
    async def before_check_events(self):
        await self.bot.wait_until_ready()
    
    async def send_event_reminder(self, event, guild, time_remaining, one_day_alarm=False):
        """이벤트 알림을 전송합니다."""
        guild_config = self.get_guild_config(guild.id)
        event_config = guild_config['event_settings'].get(event.name.lower(), {})
        
        # 알림을 보낼 채널 결정 (우선순위: 이벤트별 설정 > 서버 기본 설정 > 시스템 채널)
        notification_channel_id = (
            event_config.get('channel') or 
            guild_config.get('notification_channel')
        )
        
        if notification_channel_id:
            notification_channel = guild.get_channel(notification_channel_id)
        else:
            # 설정이 없으면 시스템 채널 또는 첫 번째 텍스트 채널 사용
            notification_channel = guild.system_channel or next(
                (ch for ch in guild.text_channels if ch.permissions_for(guild.me).send_messages), 
                None
            )
        
        if not notification_channel:
            print(f"서버 {guild.name}에서 알림을 보낼 채널을 찾을 수 없습니다.")
            return
        
        # 멘션할 역할 결정 (우선순위: 이벤트별 설정 > 서버 기본 설정)
        mention_role_id = (
            event_config.get('role') or 
            guild_config.get('mention_role')
        )
        
        mention_role = None
        if mention_role_id:
            mention_role = guild.get_role(mention_role_id)
        
        # 임베드 생성
        embed = discord.Embed(
            title=f"🔔 이벤트 알림: {event.name}",
            description=event.description or "설명이 없습니다.",
            color=discord.Color.blue(),
            timestamp=datetime.now(KST)
        )
        
        # 이벤트 정보 추가
        embed.add_field(
            name="이벤트 시작 시간",
            value=event.start_time.replace(tzinfo=pytz.UTC).astimezone(KST).strftime('%Y년 %m월 %d일 %H시 %M분'),
            inline=False
        )
        
        # 남은 시간
        minutes_remaining = int(time_remaining.total_seconds() / 60)
        embed.add_field(
            name="남은 시간",
            value=f"약 {minutes_remaining}분",
            inline=False
        )
        
        # 이벤트 위치
        if event.location:
            embed.add_field(name="위치", value=event.location, inline=False)
        
        # 이벤트 채널 (음성 채널인 경우)
        if event.channel:
            embed.add_field(name="채널", value=event.channel.mention, inline=False)
        
        # 참가자 수
        embed.add_field(
            name="관심 표시",
            value=f"{event.user_count or 0}명이 관심을 표시했습니다.",
            inline=False
        )
        
        # 이벤트 URL
        embed.add_field(
            name="이벤트 링크",
            value=f"[이벤트 페이지로 이동]({event.url})",
            inline=False
        )
        
        # 알림 메시지 전송
        try:
            # 역할 멘션 또는 @everyone
            if mention_role:
                mention_text = f"{mention_role.mention} 이벤트 '{event.name}'가 하루 남았습니다!" if one_day_alarm else f"{mention_role.mention} 이벤트 '{event.name}'가 곧 시작됩니다!"
            elif notification_channel.permissions_for(guild.me).mention_everyone:
                mention_text = f"@everyone 이벤트 '{event.name}'가 곧 시작됩니다!"
            else:
                mention_text = f"이벤트 '{event.name}'가 곧 시작됩니다!"
            
            await notification_channel.send(mention_text, embed=embed)
            
            print(f"이벤트 '{event.name}' 알림 전송 완료 (서버: {guild.name}, 채널: {notification_channel.name})")
            
        except discord.Forbidden:
            print(f"권한 부족: {guild.name}의 {notification_channel.name}에 메시지를 보낼 수 없습니다.")
        except Exception as e:
            print(f"알림 전송 중 오류: {e}")
    
    @commands.command(name='set_event_channel', aliases=['이벤트채널설정'])
    @commands.has_permissions(manage_guild=True)
    async def set_event_channel(self, ctx, channel: discord.TextChannel, role: discord.Role = None):
        """서버의 기본 이벤트 알림 채널과 멘션 역할을 설정합니다."""
        self.set_guild_config(
            ctx.guild.id, 
            channel_id=channel.id,
            role_id=role.id if role else None
        )
        
        embed = discord.Embed(
            title="✅ 이벤트 알림 설정 완료",
            color=discord.Color.green()
        )
        embed.add_field(name="알림 채널", value=channel.mention, inline=True)
        if role:
            embed.add_field(name="멘션 역할", value=role.mention, inline=True)
        
        await ctx.send(embed=embed)
    
    @commands.command(name='set_event_role', aliases=['이벤트역할설정'])
    @commands.has_permissions(manage_guild=True)
    async def set_event_role(self, ctx, role: discord.Role):
        """서버의 기본 멘션 역할을 설정합니다."""
        self.set_guild_config(ctx.guild.id, role_id=role.id)
        
        await ctx.send(f"✅ 이벤트 알림 시 {role.mention} 역할을 멘션하도록 설정했습니다.")
    
    @commands.command(name='set_specific_event', aliases=['특정이벤트설정'])
    @commands.has_permissions(manage_guild=True)
    async def set_specific_event(self, ctx, event_name: str, channel: discord.TextChannel, role: discord.Role = None):
        """특정 이벤트에 대한 개별 설정을 합니다."""
        self.set_event_config(
            ctx.guild.id,
            event_name,
            channel_id=channel.id,
            role_id=role.id if role else None
        )
        
        embed = discord.Embed(
            title="✅ 특정 이벤트 설정 완료",
            description=f"이벤트 '{event_name}'에 대한 설정이 완료되었습니다.",
            color=discord.Color.green()
        )
        embed.add_field(name="알림 채널", value=channel.mention, inline=True)
        if role:
            embed.add_field(name="멘션 역할", value=role.mention, inline=True)
        
        await ctx.send(embed=embed)
    
    @commands.command(name='show_event_settings', aliases=['이벤트설정확인'])
    async def show_event_settings(self, ctx):
        """현재 서버의 이벤트 알림 설정을 표시합니다."""
        guild_config = self.get_guild_config(ctx.guild.id)
        
        embed = discord.Embed(
            title="📋 이벤트 알림 설정",
            color=discord.Color.blue()
        )
        
        # 기본 설정
        channel_id = guild_config.get('notification_channel')
        role_id = guild_config.get('mention_role')
        
        channel = ctx.guild.get_channel(channel_id) if channel_id else None
        role = ctx.guild.get_role(role_id) if role_id else None
        
        embed.add_field(
            name="기본 알림 채널",
            value=channel.mention if channel else "설정되지 않음",
            inline=True
        )
        embed.add_field(
            name="기본 멘션 역할",
            value=role.mention if role else "설정되지 않음",
            inline=True
        )
        
        # 이벤트별 설정
        event_settings = guild_config.get('event_settings', {})
        if event_settings:
            settings_text = ""
            for event_name, settings in event_settings.items():
                event_channel = ctx.guild.get_channel(settings.get('channel'))
                event_role = ctx.guild.get_role(settings.get('role'))
                
                settings_text += f"**{event_name}**\n"
                if event_channel:
                    settings_text += f"  채널: {event_channel.mention}\n"
                if event_role:
                    settings_text += f"  역할: {event_role.mention}\n"
                settings_text += "\n"
            
            if settings_text:
                embed.add_field(
                    name="이벤트별 설정",
                    value=settings_text[:1024],  # Discord 필드 길이 제한
                    inline=False
                )
        
        await ctx.send(embed=embed)
    
    @commands.command(name='clear_event_settings', aliases=['이벤트설정초기화'])
    @commands.has_permissions(manage_guild=True)
    async def clear_event_settings(self, ctx):
        """서버의 이벤트 알림 설정을 초기화합니다."""
        if str(ctx.guild.id) in self.config:
            del self.config[str(ctx.guild.id)]
            self.save_config()
            await ctx.send("✅ 이벤트 알림 설정이 초기화되었습니다.")
        else:
            await ctx.send("이미 설정이 없습니다.")
    async def upcoming_events(self, ctx):
        """서버의 예정된 이벤트 목록을 표시합니다."""
        try:
            events = await ctx.guild.fetch_scheduled_events()
            
            # 예정된 이벤트만 필터링
            scheduled_events = [e for e in events if e.status == discord.EventStatus.scheduled]
            
            if not scheduled_events:
                await ctx.send("현재 예정된 이벤트가 없습니다.")
                return
            
            embed = discord.Embed(
                title="📅 예정된 이벤트",
                color=discord.Color.green(),
                timestamp=datetime.now(KST)
            )
            
            # 시작 시간 순으로 정렬
            scheduled_events.sort(key=lambda e: e.start_time)
            
            for event in scheduled_events[:10]:  # 최대 10개만 표시
                start_time = event.start_time.replace(tzinfo=pytz.UTC).astimezone(KST)
                
                # 남은 시간 계산
                time_remaining = start_time - datetime.now(KST)
                hours, remainder = divmod(int(time_remaining.total_seconds()), 3600)
                minutes, _ = divmod(remainder, 60)
                
                field_value = f"시작: {start_time.strftime('%m/%d %H:%M')}\n"
                field_value += f"남은 시간: {hours}시간 {minutes}분\n"
                
                embed.add_field(
                    name=f"{event.name}",
                    value=field_value,
                    inline=False
                )
            
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"이벤트를 가져오는 중 오류가 발생했습니다: {e}")
    
    @commands.command(name='event_info', aliases=['이벤트정보'])
    async def event_info(self, ctx, *, event_name: str):
        """특정 이벤트의 상세 정보를 표시합니다."""
        try:
            events = await ctx.guild.fetch_scheduled_events()
            
            # 이름으로 이벤트 찾기
            event = next((e for e in events if event_name.lower() in e.name.lower()), None)
            
            if not event:
                await ctx.send(f"'{event_name}'라는 이름의 이벤트를 찾을 수 없습니다.")
                return
            
            embed = discord.Embed(
                title=event.name,
                description=event.description or "설명이 없습니다.",
                color=discord.Color.blue()
            )
            
            # 이벤트 상태
            status_emoji = {
                discord.EventStatus.scheduled: "⏰",
                discord.EventStatus.active: "🔴",
                discord.EventStatus.completed: "✅",
                discord.EventStatus.cancelled: "❌"
            }
            
            embed.add_field(
                name="상태",
                value=f"{status_emoji.get(event.status, '❓')} {event.status.name}",
                inline=True
            )
            
            # 시작 시간
            start_time = event.start_time.replace(tzinfo=pytz.UTC).astimezone(KST)
            embed.add_field(
                name="시작 시간",
                value=start_time.strftime('%Y년 %m월 %d일 %H시 %M분'),
                inline=True
            )
            
            # 종료 시간 (있는 경우)
            if event.end_time:
                end_time = event.end_time.replace(tzinfo=pytz.UTC).astimezone(KST)
                embed.add_field(
                    name="종료 시간",
                    value=end_time.strftime('%Y년 %m월 %d일 %H시 %M분'),
                    inline=True
                )
            
            if event.cover_image:
                embed.set_image(url=event.cover_image.url)
            
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"이벤트 정보를 가져오는 중 오류가 발생했습니다: {e}")

# Cog 설정
async def setup(bot):
    await bot.add_cog(ScheduledEventReminder(bot))
