import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "מחולל תחזית · V1",
  description: "Weather forecast video generator",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/weather-v1-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/weather-v1-icon-512.png", sizes: "512x512", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800;900&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@yaireo/tagify@4.27.0/dist/tagify.css"
        />
        <script
          defer
          src="https://cdn.jsdelivr.net/npm/@yaireo/tagify@4.27.0/dist/tagify.min.js"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
