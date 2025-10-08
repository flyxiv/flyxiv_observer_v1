"use client";
import { useEffect, useState, useRef } from "react";
import { pullStartDetected, pullEndDetected, predictScores } from "./PullDetectorModel";

type Entry = {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: 'recording' | 'completed';
  src?: string; // blob URL of the recorded media
  path?: string; // original disk path when saved
  _recorder?: MediaRecorder;
  _chunks?: Blob[];
  _stream?: MediaStream;
  _recStream?: MediaStream;
  _cleanup?: () => void;
};


export default function RecordList() {
  const [list, setList] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detectorCleanupRef = useRef<(() => void) | null>(null);

  const pickSupportedMime = () => {
    // Prioritize H.264 - usually hardware accelerated and handles motion best
    const candidates = [
      'video/webm;codecs=h264',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (const c of candidates) {
      // @ts-ignore: isTypeSupported exists in browsers
      if (typeof MediaRecorder !== 'undefined' && (MediaRecorder as any).isTypeSupported?.(c)) return c;
    }
    return undefined;
  };

  const getDisplayStream = async (): Promise<MediaStream> => {
    const bridge = (window as any).ffxiv;
    
    // 1. First priority: Try to capture FFXIV window directly
    if (bridge?.selectFfxivWindow) {
      try {
        const src = await bridge.selectFfxivWindow();
        if (src?.id) {
          console.log('Capturing FFXIV window:', src.name);
          const constraints: any = {
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: src.id,
                maxFrameRate: 60
              }
            }
          };
          // @ts-ignore electron-specific constraints
          return await navigator.mediaDevices.getUserMedia(constraints);
        }
      } catch (err) {
        console.warn('FFXIV window capture failed, trying screen capture...', err);
      }
    }
    
    // 2. Fallback: Try screen capture via IPC
    const select = bridge?.selectDesktopSource || bridge?.getSource;
    if (select) {
      try {
        const src = await select();
        if (src?.id) {
          console.log('Capturing screen:', src.name);
          const constraints: any = {
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: src.id,
                maxFrameRate: 60
              }
            }
          };
          // @ts-ignore electron-specific constraints
          return await navigator.mediaDevices.getUserMedia(constraints);
        }
      } catch (err) {
        console.warn('IPC desktop source failed, falling back to getDisplayMedia', err);
      }
    }
    
    // 3. Last resort: Use the standard picker
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (e) {
      console.warn('getDisplayMedia with audio failed, falling back to video-only', e);
      return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false as any });
    }
  };

  // Background: feed 1 frame/sec to AI
  // Uses user-implemented IsPullStart/IsPullEnd if available; otherwise falls back to window.ffxiv.analyzeFrame
  useEffect(() => {
    let stopped = false;
    let intervalId: any = null;
    let localStream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    const startDetector = async () => {
      try {
        const bridge = (window as any).ffxiv;
        let stream: MediaStream | null = null;
        
        // 1. Try FFXIV window first for detector
        if (bridge?.selectFfxivWindow) {
          try {
            const src = await bridge.selectFfxivWindow();
            if (src?.id) {
              const constraints: any = {
                audio: false,
                video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 30 } }
              };
              stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
              console.log('AI detector capturing FFXIV window');
            }
          } catch (e) {
            console.warn('AI detector: FFXIV window capture failed', e);
          }
        }
        
        // 2. Fallback to screen capture
        if (!stream) {
          try {
            const sel = bridge?.selectDesktopSource || bridge?.getSource;
            if (sel) {
              const src = await sel();
              if (src?.id) {
                const constraints: any = {
                  audio: false,
                  video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 30 } }
                };
                stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
                console.log('AI detector capturing screen');
              }
            }
          } catch (e) {
            // ignore and fall back
          }
        }
        
        // 3. Last resort
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false as any });
          } catch {
            return; // cannot start detector in this environment
          }
        }

        localStream = stream;
        video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => {});
        await new Promise<void>((resolve) => {
          if ((video as HTMLVideoElement).videoWidth) return resolve();
          const on = () => { (video as HTMLVideoElement).removeEventListener('loadedmetadata', on); resolve(); };
          (video as HTMLVideoElement).addEventListener('loadedmetadata', on);
          setTimeout(resolve, 250);
        });
        canvas = document.createElement('canvas');
        const maxW = 512;
        const vw = (video as HTMLVideoElement).videoWidth || 1280;
        const vh = (video as HTMLVideoElement).videoHeight || 720;
        const scale = Math.min(1, maxW / vw);
        canvas.width = Math.max(2, Math.floor(vw * scale));
        canvas.height = Math.max(2, Math.floor(vh * scale));
        ctx = canvas.getContext('2d', { willReadFrequently: true });

        // detector dispatchers
        const getDetectors = () => {
          const fStart = pullStartDetected;
          const fEnd = pullEndDetected;
          return { fStart, fEnd };
        };

        const callBoolean = async (fn: any, scores: [Float32Array, Float32Array], which: 'start' | 'end') => {
          try {
            if (!fn) return false;
            const res = await fn(scores);
            if (typeof res === 'boolean') return res;
            if (res && typeof res === 'object') {
              if (which === 'start') return !!(res.pullStarted ?? res.started ?? res.isStart ?? res.start);
              if (which === 'end') return !!(res.pullEnded ?? res.ended ?? res.isEnd ?? res.end);
            }
          } catch {}
          return false;
        };

        intervalId = setInterval(async () => {
          if (stopped || !ctx || !video) return;
          try {
            ctx.drawImage(video, 0, 0, canvas!.width, canvas!.height);
            const img = ctx.getImageData(0, 0, canvas!.width, canvas!.height);
            const { fStart, fEnd } = getDetectors();

            // TODO: Disable AI detection when manual recording is active
            const scores = await predictScores(img);
            console.log(scores);
            if (!scores) return;
            const started = await callBoolean(fStart, scores, 'start') && !isManualRecording;
            const ended = await callBoolean(fEnd, scores, 'end') && !isManualRecording;
            if (started && !activeId) startRecording();
            if (ended && activeId) stopRecording();
          } catch {
            // ignore per-frame errors
          }
        }, 1000);
      } catch {
        // ignore detector errors
      }
    };

    startDetector();

    const cleanup = () => {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
      try { localStream?.getTracks().forEach(t => t.stop()); } catch {}
      video = null;
      canvas = null;
      ctx = null;
    };
    detectorCleanupRef.current = cleanup;
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Convert a display stream to a canvas-captured stream to maximize
  // MediaRecorder compatibility on some environments.
  const toCanvasStream = async (src: MediaStream, fps = 60): Promise<{ out: MediaStream; cleanup: () => void; }> => {
    const video = document.createElement('video');
    video.srcObject = src;
    video.muted = true;
    await video.play().catch(() => {});
    await new Promise<void>((resolve) => {
      if (video.videoWidth && video.videoHeight) return resolve();
      const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); };
      video.addEventListener('loadedmetadata', onLoaded);
      setTimeout(resolve, 250);
    });
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const draw = () => { if (ctx) ctx.drawImage(video, 0, 0, w, h); raf = requestAnimationFrame(draw); };
    draw();
    const out: MediaStream = (canvas as any).captureStream ? (canvas as any).captureStream(fps) : (canvas as any).mozCaptureStream?.(fps);
    const cleanup = () => { try { cancelAnimationFrame(raf); } catch {} try { out.getTracks().forEach(t => t.stop()); } catch {} };
    return { out, cleanup };
  };

  const [isRecording, setIsRecording] = useState(false);
  const [isManualRecording, setIsManualRecording] = useState(false);

  const startRecording = async () => {
    try {
      if (isRecording) return;

      setError(null);
      const id = crypto.randomUUID();
      const name = `Pull ${new Date().toLocaleTimeString()}`;
      const stream = await getDisplayStream();
      if (!stream.getVideoTracks().length) throw new Error('No video track in captured stream');
      
      // Try to record original stream first for best performance
      let recStream: MediaStream = stream;
      let cleanup: () => void = () => {};
      let useCanvas = false;
      
      // Set video track hints for better encoding
      const track = stream.getVideoTracks()[0];
      try {
        if ('contentHint' in track) (track as any).contentHint = 'motion';
        // Try to ensure 60fps
        await track.applyConstraints({ 
          frameRate: { ideal: 60, min: 30 } 
        });
      } catch (err) {
        console.warn('Could not apply track constraints:', err);
      }
      
      const chunks: Blob[] = [];
      const mimeType = pickSupportedMime();
      console.log('Using codec:', mimeType);
      let recorder: MediaRecorder;
      
      // Get actual track settings to compute appropriate bitrate
      const trackSettings = track.getSettings();
      const width = trackSettings.width || 1920;
      const height = trackSettings.height || 1080;
      const fps = trackSettings.frameRate || 60;
      
      console.log(`Source: ${width}x${height} @ ${fps}fps`);
      
      // Calculate bitrate based on resolution (more reasonable for H.264)
      // H.264 needs less bitrate than VP8/VP9 for same quality
      const pixelCount = width * height;
      const baseRate = 0.15; // bits per pixel per frame for H.264
      const bitrate = Math.floor(pixelCount * fps * baseRate);
      const clampedBitrate = Math.min(Math.max(bitrate, 20_000_000), 60_000_000);
      
      const opts: any = { 
        videoBitsPerSecond: clampedBitrate,
        bitsPerSecond: clampedBitrate,
        audioBitsPerSecond: 256_000
      };
      
      console.log(`Recording at ${(clampedBitrate / 1_000_000).toFixed(1)} Mbps`);
      
      try {
        recorder = mimeType ? new MediaRecorder(recStream, { mimeType, ...opts }) : new MediaRecorder(recStream, opts);
        console.log('Recording original stream directly');
      } catch (err) {
        console.warn('MediaRecorder on original stream failed, falling back to canvas', err);
        useCanvas = true;
        const conv = await toCanvasStream(stream, 60);
        recStream = conv.out;
        cleanup = conv.cleanup;
        try {
          recorder = mimeType ? new MediaRecorder(recStream, { mimeType, ...opts }) : new MediaRecorder(recStream, opts);
          console.log('Recording canvas stream');
        } catch (err2) {
          console.warn('MediaRecorder with opts failed, trying basic...', err2);
          recorder = new MediaRecorder(recStream);
        }
      }
      
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      setIsRecording(true);
      // Use 500ms timeslice - balances encoding efficiency with responsiveness
      // H.264 hardware encoders work better with slightly larger chunks
      try { recorder.start(500); } catch { recorder.start(); }

      const entry: Entry = {
        id,
        name,
        startedAt: Date.now(),
        status: 'recording',
        _recorder: recorder,
        _chunks: chunks,
        _stream: stream,
        _recStream: recStream,
        _cleanup: () => {
          try { cleanup(); } catch {}
          if (!useCanvas) {
            try { stream.getTracks().forEach(t => t.stop()); } catch {}
          }
        },
      };
      setList((prev) => [entry, ...prev]);
      setActiveId(id);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setError(err?.message ?? 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    if (!activeId) return;
    const current = list.find(l => l.id === activeId);
    if (!current) return;
    const recorder = current._recorder;
    const stream = current._stream;
    const recStream = current._recStream;
    try {
      const waitForStop = new Promise<void>((resolve) => {
        if (!recorder) return resolve();
        if ((recorder as any).state === 'inactive') return resolve();
        recorder.addEventListener('stop', () => resolve(), { once: true });
      });
      try { recorder?.stop(); } catch {}
      try { stream?.getTracks().forEach(t => t.stop()); } catch {}
      try { recStream?.getTracks().forEach(t => t.stop()); } catch {}
      try { current._cleanup?.(); } catch {}
      await waitForStop;
      const endedAt = Date.now();
      const blob = new Blob(current._chunks ?? [], { type: (recorder as any)?.mimeType || 'video/webm' });
      try {
        const arr = await blob.arrayBuffer();
        const bridge = (window as any).ffxiv;
        let fileUrl: string | undefined;
        let savedPath: string | undefined;
        if (bridge?.saveRecording) {
          const ext = /mp4/i.test((recorder as any)?.mimeType || '') ? 'mp4' : 'webm';
          const saved = await bridge.saveRecording(arr, current.name, ext);
          if (saved?.path) {
            savedPath = saved.path;
            fileUrl = typeof bridge.pathToFileUrl === 'function' ? bridge.pathToFileUrl(saved.path) : `file:///${saved.path.replace(/\\/g, '/')}`;
          }
        }
        const finalSrc = fileUrl || URL.createObjectURL(blob);
        setList((prev) => prev.map((e) => e.id === activeId ? { ...e, status: 'completed', endedAt, src: finalSrc, path: savedPath, _recorder: undefined, _chunks: undefined, _stream: undefined } : e));
      } catch {
        const url = URL.createObjectURL(blob);
        setList((prev) => prev.map((e) => e.id === activeId ? { ...e, status: 'completed', endedAt, src: url, _recorder: undefined, _chunks: undefined, _stream: undefined } : e));
      }
    } finally {
      setActiveId(null);
      setIsRecording(false);
    }
  };

  const startManualRecording = () => {
    setIsManualRecording(true);
    startRecording();
  };

  const stopManualRecording = () => {
    setIsManualRecording(false);
    stopRecording();
  };

  useEffect(() => {
    // Keyboard shortcuts to simulate AI triggers
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's') startManualRecording();
      if (e.key.toLowerCase() === 'e') stopManualRecording();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId]);

  useEffect(() => {
    // Cleanup blob URLs when unmounting
    return () => {
      list.forEach(l => { if (l.src?.startsWith('blob:')) URL.revokeObjectURL(l.src); });
    };
  }, [list]);

  useEffect(() => {
    // Load existing recordings saved on disk
    (async () => {
      const bridge = (window as any).ffxiv;
      if (!bridge?.listRecordings) return;
      try {
        const items: any[] = await bridge.listRecordings();
        const mapped: Entry[] = (items || []).map((it) => {
          const src = typeof bridge.pathToFileUrl === 'function' ? bridge.pathToFileUrl(it.path) : `file:///${String(it.path || '').replace(/\\\\/g, '/')}`;
          return {
            id: it.id || crypto.randomUUID(),
            name: it.name || 'Recording',
            startedAt: Math.floor(it.mtimeMs || Date.now()),
            endedAt: Math.floor(it.mtimeMs || Date.now()),
            status: 'completed',
            src,
            path: it.path,
          } as Entry;
        });
        if (mapped.length) setList((prev) => {
          // Avoid duplicating if already loaded in this session
          const existing = new Set(prev.map(p => p.id));
          const merged = [...mapped.filter(m => !existing.has(m.id)), ...prev];
          // Sort by time desc
          return merged.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        });
      } catch {}
    })();
  }, []);

  const handleScreenshot = () => {
    const takeScreenshot = (window as any).takeScreenshot;
    if (takeScreenshot) takeScreenshot();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid #222' }}>
        <button onClick={handleScreenshot} style={btn}>Screenshot</button>
        <div style={{ flex: 1 }} />
        <button onClick={startManualRecording} style={btn}>Manual Start (S)</button>
        <button onClick={stopManualRecording} style={btn} disabled={!activeId}>Manual End (E)</button>
        {error && <span style={{ color: '#ff7676', marginLeft: 12 }}>{error}</span>}
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        {list.length === 0 ? (
          <div style={{ padding: 12, color: '#888' }}>No records yet. Press S to start manual recording.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((e) => (
              <li
                key={e.id}
                style={{ borderBottom: '1px solid #222', padding: 10, display: 'flex', justifyContent: 'space-between', cursor: e.status === 'completed' && e.src ? 'pointer' : 'default' }}
                title={e.status === 'completed' ? 'Click to play' : ''}
                onClick={() => {
                  if (e.status === 'completed' && e.src) {
                    window.dispatchEvent(new CustomEvent('play-record', { detail: { id: e.id, name: e.name, src: e.src, path: e.path } }));
                  }
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: '#aaa' }}>
                    {new Date(e.startedAt).toLocaleString()} {e.endedAt ? `→ ${new Date(e.endedAt).toLocaleTimeString()}` : ''}
                  </div>
                </div>
                <div style={{ color: e.status === 'recording' ? '#ffc107' : '#7bd88f' }}>
                  {e.status}
                </div>
              </li>
            ))}
          </ul>
        )}
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
