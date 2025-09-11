export {};

declare global {
  interface Window {
    ffxiv?: {
      version?: string;
      selectPrimaryScreen?: () => Promise<{ id: string; name: string }>;
      selectDesktopSource?: () => Promise<{ id: string; name: string }>;
      getSource?: () => Promise<{ id: string; name: string }>;
      // Optional AI hook. Receives a downscaled ImageData (~1fps) and returns
      // detection result. Implemented externally by the user.
      analyzeFrame?: (img: ImageData) => Promise<{ pullStarted?: boolean; pullEnded?: boolean } | null>;
    };
    playRecord?: (detail: { id: string; name: string; src: string }) => void;
  }
}
