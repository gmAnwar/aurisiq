import type { Metadata } from 'next';
import './globals.css';
import AuthNav from './components/AuthNav';

export const metadata: Metadata = {
  title: 'AurisIQ',
  description: 'Análisis de llamadas de venta con IA',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
