import type { Metadata } from "next";
import { Inter, Space_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";
import { ThemeProvider } from "@/components/ThemeProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ed4ns — Survival Game",
  description:
    "An open-edition NFT survival game. Mint a token. Cuts happen every round. The final 4 share the prize pool.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceMono.variable}`}>
        <ThemeProvider>
          <Providers>
            <Navbar />
            <main>{children}</main>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
