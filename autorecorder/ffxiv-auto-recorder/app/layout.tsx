import type React from 'react';
export const metadata = {
  title: 'FFXIV Auto Recorder',
  description: 'Auto-detect pulls and record replays with embedded player.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0b0b0b', color: '#eaeaea', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
