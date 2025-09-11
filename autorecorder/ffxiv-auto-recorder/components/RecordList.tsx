"use client";
import { useEffect, useState, useRef } from "react";
import { pullStartDetected, pullEndDetected } from "./PullDetectorModel";

type Entry = {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: 'recording' | 'completed';
  src?: string; // blob URL of the recorded media
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
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const detectorCleanupRef = useRef<(() => void) | null>(null);

  const pickSupportedMime = () => {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    for (const c of candidates) {
      // @ts-ignore: isTypeSupported exists in browsers
      if (typeof MediaRecorder !== 'undefined' && (MediaRecorder as any).isTypeSupported?.(c)) return c;
    }
    return undefined;
  };

  const getDisplayStream = async (): Promise<MediaStream> => {
    // First, try Electron IPC to select a single screen (works even when getDisplayMedia is blocked)
    const bridge = (window as any).ffxiv;
    const select = bridge?.selectDesktopSource || bridge?.getSource;
    if (select) {
      try {
        const src = await select();
        if (src?.id) {
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
    // Use the standard picker so you choose a single screen/window
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
        // Prefer IPC desktop source to avoid prompts for background detector
        const bridge = (window as any).ffxiv;
        let stream: MediaStream | null = null;
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
            }
          }
        } catch (e) {
          // ignore and fall back
        }
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

        const callBoolean = async (fn: any, img: ImageData, which: 'start' | 'end') => {
          try {
            if (!fn) return false;
            const res = await fn(img);
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
            const started = await callBoolean(fStart, img, 'start') && !isManualRecording;
            const ended = await callBoolean(fEnd, img, 'end') && !isManualRecording;
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
  const toCanvasStream = async (src: MediaStream, fps = 30): Promise<{ out: MediaStream; cleanup: () => void; }> => {
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
      const { out: recStream, cleanup } = await toCanvasStream(stream, 30);
      const chunks: Blob[] = [];
      const mimeType = pickSupportedMime();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(recStream, { mimeType }) : new MediaRecorder(recStream);
      } catch (err) {
        console.warn('MediaRecorder with mime failed, trying without...', err);
        recorder = new MediaRecorder(recStream);
      }
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => { try { cleanup(); } catch {} };
      setIsRecording(true);
      recorder.start();

      const entry: Entry = {
        id,
        name,
        startedAt: Date.now(),
        status: 'recording',
        _recorder: recorder,
        _chunks: chunks,
        _stream: stream,
        _recStream: recStream,
        _cleanup: cleanup,
      };
      setList((prev) => [entry, ...prev]);
      setActiveId(id);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setError(err?.message ?? 'Failed to start recording');
      try { filePickerRef.current?.click(); } catch {}
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
      const url = URL.createObjectURL(blob);
      setList((prev) => prev.map((e) => e.id === activeId ? { ...e, status: 'completed', endedAt, src: url, _recorder: undefined, _chunks: undefined, _stream: undefined } : e));
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #222' }}>
        <button onClick={startManualRecording} style={btn}>Pull Start (S)</button>
        <button onClick={stopManualRecording} style={btn} disabled={!activeId}>Pull End (E)</button>
        {error && <span style={{ color: '#ff7676', marginLeft: 12 }}>{error}</span>}
        <input
          ref={filePickerRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            const id = crypto.randomUUID();
            const entry: Entry = { id, name: f.name, startedAt: Date.now(), endedAt: Date.now(), status: 'completed', src: url };
            setList((prev) => [entry, ...prev]);
            e.currentTarget.value = '';
          }}
        />
        <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={() => filePickerRef.current?.click()}>Add Video (fallback)</button>
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        {list.length === 0 ? (
          <div style={{ padding: 12, color: '#888' }}>No records yet. Press S to simulate.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((e) => (
              <li
                key={e.id}
                style={{ borderBottom: '1px solid #222', padding: 10, display: 'flex', justifyContent: 'space-between', cursor: e.status === 'completed' && e.src ? 'pointer' : 'default' }}
                title={e.status === 'completed' ? 'Click to play' : ''}
                onClick={() => {
                  if (e.status === 'completed' && e.src) {
                    window.dispatchEvent(new CustomEvent('play-record', { detail: { id: e.id, name: e.name, src: e.src } }));
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
