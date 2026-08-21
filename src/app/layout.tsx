import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import Header from "@/components/header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VaultDrop - Secure Secret Delivery",
  description: "Deliver sensitive secrets with verified one-time access, expiration, and revocation control. Zero-knowledge encryption - the server never sees your plaintext.",
  keywords: ["secure", "encrypted", "secrets", "zero-knowledge", "delivery", "end-to-end-encrypted"],
  openGraph: {
    title: "VaultDrop - Secure Secret Delivery",
    description: "Deliver sensitive secrets with verified one-time access, expiration, and revocation control.",
    url: "https://vaultdrop.app",
    siteName: "VaultDrop",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Header />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
