"use client";
import { useEffect, useRef, useState } from "react";
import type React from 'react';

type Recording = {
  id: string;
  name: string;
  src: string;
  duration?: number;
  path?: string; // optional original file path for fallback
};

export default function PlayerPane() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [selected, setSelected] = useState<Recording | null>(null);

  // Expose a global playRecord bridge for RecordList
  useEffect(() => {
    (window as any).playRecord = (detail: { id: string; name: string; src: string; path?: string }) => {
      if (!detail?.src) return;
      const rec: Recording = { id: detail.id, name: detail.name, src: detail.src, path: detail.path };
      setSelected(rec);
      const v = videoRef.current;
      if (v) {
        v.src = rec.src;
        v.load(); // Properly load the video
        v.currentTime = 0; // Reset to start
      }
    };
    
    // Expose screenshot function for RecordList
    (window as any).takeScreenshot = async () => {
      const video = videoRef.current;
      if (!video || !selected) return;
      
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/png');
        
        // Copy to clipboard using native Electron clipboard
        const bridge = (window as any).ffxiv;
        if (bridge?.copyImageToClipboard) {
          await bridge.copyImageToClipboard(dataUrl);
        }
      } catch (err) {
        console.error('Screenshot failed:', err);
      }
    };
    const onPlayRecordEvent = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; name: string; src: string; path?: string }>).detail;
      (window as any).playRecord?.(d);
    };
    window.addEventListener('play-record', onPlayRecordEvent as EventListener);
    return () => {
      try { delete (window as any).playRecord; } catch {}
      try { delete (window as any).takeScreenshot; } catch {}
      window.removeEventListener('play-record', onPlayRecordEvent as EventListener);
    };
  }, [selected]);

  const onLoadedMetadata = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, padding: 12, boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, minWidth: 0 }}>
        <div style={{ position: 'relative', background: '#111', border: '1px solid #222', borderRadius: 8, flex: 1, minHeight: 0, minWidth: 0 }}>
          {selected ? (
            <video
              ref={videoRef}
              src={selected.src}
              style={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%', 
                height: '100%', 
                objectFit: 'contain', 
                background: 'black'
              }}
              controls
              preload="metadata"
              onLoadedMetadata={onLoadedMetadata}
              onError={async () => {
                // Fallback: if file:// blocked, load as data URL via IPC
                try {
                  const bridge = (window as any).ffxiv;
                  if (selected?.path && bridge?.readFileDataUrl) {
                    const dataUrl = await bridge.readFileDataUrl(selected.path);
                    if (videoRef.current) {
                      videoRef.current.src = dataUrl;
                      await videoRef.current.play().catch(() => {});
                    }
                  }
                } catch {}
              }}
            />
          ) : (
            <div style={{ padding: 24, color: '#aaa', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              Click a record below to play.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
