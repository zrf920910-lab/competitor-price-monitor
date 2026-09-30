import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { DbProvider } from '@/components/DbProvider';

export const metadata: Metadata = {
  title: {
    default: '竞品价格监控',
    template: '%s · 竞品价格监控',
  },
  description: '淘宝竞品 SKU 价格抓取、自动分类与跨店横向对比。数据本地存储，可离线使用。',
  applicationName: '竞品价格监控',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '价格监控',
  },
  formatDetection: { telephone: false, date: false, email: false, address: false },
  icons: {
    icon: [
      { url: '/icons/favicon.png', sizes: '64x64', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#3765f5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <DbProvider>
          <AppShell>{children}</AppShell>
        </DbProvider>
      </body>
    </html>
  );
}
