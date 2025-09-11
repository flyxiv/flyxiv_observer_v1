"use client";
import { useEffect, useRef, useState } from "react";
import type React from 'react';

type Recording = {
  id: string;
  name: string;
  src: string;
  duration?: number;
};

export default function PlayerPane() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [selected, setSelected] = useState<Recording | null>(null);
  const [segments, setSegments] = useState<{ t: number; label: string }[]>([]);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Expose a global playRecord bridge for RecordList
  useEffect(() => {
    (window as any).playRecord = (detail: { id: string; name: string; src: string }) => {
      if (!detail?.src) return;
      const rec: Recording = { id: detail.id, name: detail.name, src: detail.src };
      setSelected(rec);
      const v = videoRef.current;
      if (v) {
        v.src = rec.src;
        v.play().catch(() => {});
        setIsPlaying(true);
      }
    };
    const onPlayRecordEvent = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; name: string; src: string }>).detail;
      (window as any).playRecord?.(d);
    };
    window.addEventListener('play-record', onPlayRecordEvent as EventListener);
    return () => {
      try { delete (window as any).playRecord; } catch {}
      window.removeEventListener('play-record', onPlayRecordEvent as EventListener);
    };
  }, []);

  const onLoadedMetadata = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  const togglePlay = async () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      await videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const takeScreenshot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = Math.floor(video.currentTime);
      a.download = `${selected?.name ?? 'screenshot'}_${ts}s.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const addMarkIn = () => {
    const t = videoRef.current?.currentTime ?? 0;
    setMarkIn(t);
  };

  const addMarkOut = () => {
    const t = videoRef.current?.currentTime ?? 0;
    if (markIn == null) return;
    const start = Math.min(markIn, t);
    const end = Math.max(markIn, t);
    setSegments((prev) => [{ t: start, label: `Start ${fmt(start)}` }, { t: end, label: `End ${fmt(end)}` }, ...prev]);
    setMarkIn(null);
  };

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const onTimeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const dur = videoRef.current?.duration ?? 0;
    seek(ratio * dur);
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, padding: 12 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ position: 'relative', background: '#111', border: '1px solid #222', borderRadius: 8, overflow: 'hidden', flex: 1 }}>
          {selected ? (
            <video
              ref={videoRef}
              src={selected.src}
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'black' }}
              controls
              onLoadedMetadata={onLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
          ) : (
            <div style={{ padding: 24, color: '#aaa' }}>Click a record below to play.</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={togglePlay} disabled={!selected} style={btn}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={takeScreenshot} disabled={!selected} style={btn}>
            Screenshot
          </button>
          <button onClick={addMarkIn} disabled={!selected} style={btn}>Mark In</button>
          <button onClick={addMarkOut} disabled={!selected || markIn == null} style={btn}>Mark Out</button>
          <div style={{ flex: 1, height: 8, background: '#1f1f1f', borderRadius: 4, cursor: 'pointer' }} onClick={onTimeClick} title="Click to seek" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {segments.map((s, i) => (
            <button key={i} style={chip} onClick={() => seek(s.t)}>{s.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: '#1f2a3a',
  color: '#eaeaea',
  border: '1px solid #2e3d52',
  padding: '8px 12px',
  borderRadius: 6,
  cursor: 'pointer'
};

const chip: React.CSSProperties = {
  background: '#222',
  color: '#ddd',
  border: '1px solid #333',
  padding: '4px 8px',
  borderRadius: 999,
  cursor: 'pointer'
};

function fmt(sec: number) {
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
