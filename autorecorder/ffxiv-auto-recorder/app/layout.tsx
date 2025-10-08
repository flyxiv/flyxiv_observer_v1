import type React from 'react';
export const metadata = {
  title: 'FFXIV Auto Recorder',
  description: 'Auto-detect pulls and record replays with embedded player.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isProd = process.env.NODE_ENV === 'production';
  return (
    <html lang="en">
      <head>
        {isProd && (
          <meta
            httpEquiv="Content-Security-Policy"
            content={[
              "default-src 'self'",
              "img-src 'self' data: blob: file:",
              "media-src 'self' data: blob: file:",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              // Allow local ws for devtools in production packaging if needed comment/remove if not
              // "connect-src 'self'",
            ].join('; ')}
          />
        )}
      </head>
      <body style={{ margin: 0, background: '#0b0b0b', color: '#eaeaea', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
