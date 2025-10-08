export {};

declare global {
  interface Window {
    ffxiv?: {
      version?: string;
      selectPrimaryScreen?: () => Promise<{ id: string; name: string }>;
      selectDesktopSource?: () => Promise<{ id: string; name: string }>;
      getSource?: () => Promise<{ id: string; name: string }>;
      saveRecording?: (buffer: ArrayBuffer | Uint8Array, suggestedName?: string, extension?: string) => Promise<{ path: string; filename: string }>;
      listRecordings?: () => Promise<Array<{ id: string; name: string; path: string; mtimeMs: number; size: number }>>;
      readFileDataUrl?: (p: string) => Promise<string>;
      pathToFileUrl?: (p: string) => string;
      // Optional AI hook. Receives a downscaled ImageData (~1fps) and returns
      // detection result. Implemented externally by the user.
      analyzeFrame?: (img: ImageData) => Promise<{ pullStarted?: boolean; pullEnded?: boolean } | null>;
    };
    playRecord?: (detail: { id: string; name: string; src: string }) => void;
  }
}
