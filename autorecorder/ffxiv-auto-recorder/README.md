FFXIV Auto Recorder (Next.js + Electron, TypeScript)

What's included
- Next.js 15 (App Router) + React 19 UI (TypeScript)
- Electron 38 main process that opens the Next dev server
- Player pane with embedded HTML5 video, play/pause, seek by click, screenshot capture, and segment marks
- Record list at the bottom half with simulated entries and start/end triggers (S/E keys)
- AI hooks left unimplemented as requested: pullStartDetected()/pullEndDetected()

Getting started
1) Install dependencies
   cd ffxiv-auto-recorder
   npm install

2) Development: run Next and Electron in two terminals
   Terminal A: npm run dev:renderer
   Terminal B: npm run dev:electron

   Electron loads http://localhost:3000 and opens DevTools in development.

Usage tips
- Import local videos via the Import Videos button (right side of the player pane).
- Click the thin timeline bar below the player to seek.
- Use Mark In / Mark Out to create quick segment markers; click markers to jump.
- Click Screenshot to save a PNG of the current frame.
- Press S to simulate a pull start; press E to simulate a pull end. Entries appear in the lower list.

Notes
- AI detection stubs are defined in components/RecordList.tsx. Wire your model calls there to start/stop recording.
- For production packaging you’ll likely want electron-builder or Electron Forge; this scaffold focuses on dev flow.
- Type checking: npm run typecheck
