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
    "A 100% on-chain survival game built on top of regular open edition mints. You can launch your own collection + game with a dynamic prize pool, where random eliminations continue until the final 4 split the pot.",
  other: {
    "base:app_id": "6a238e9711cac27e581f114e",
    "talentapp:project_verification": "4053361357a3a3048c9d64e1f1769bb29978ad3337f9d977bd32a99ccafcb76874e189f13a839828a05fd226ea0f846c609464e0ba7f6f5eb46cc8c5fcf82b68"
  },
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
