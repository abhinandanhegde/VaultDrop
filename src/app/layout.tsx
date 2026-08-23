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
  description: "Deliver sensitive secrets and files via one-time links with PINs, expiry, revocation, and self-destruction. Encrypted in your browser — the server only ever stores ciphertext.",
  keywords: ["secure", "encrypted", "secrets", "end-to-end encryption", "delivery", "one-time-link"],
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
