import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "getBible.Life",
  description: "Read, mark, and revisit Scripture with getBible.Life.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: { url: "/favicon.png", type: "image/png", sizes: "96x96" },
    shortcut: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('getbible-reader:theme:v1');var m=localStorage.getItem('getbible-reader:theme-mode:v1')||(t?'manual':'system');var l=localStorage.getItem('getbible-reader:light-palette:v1');var d=localStorage.getItem('getbible-reader:dark-palette:v1');document.documentElement.dataset.theme=m==='manual'&&t?t:(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.dataset.palette=l||'white';document.documentElement.dataset.darkPalette=d||'black'}catch(e){}`}} /></head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
