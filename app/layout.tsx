import type { Metadata } from "next";
import { Geist_Mono, Inter, Noto_Sans_Thai } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const thai = Noto_Sans_Thai({ variable: "--font-thai", subsets: ["thai"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Timesheet Autofill",
  description: "Draft ClickNext timesheet entries from LINE chat and GitLab commits",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" suppressHydrationWarning className={`${inter.variable} ${thai.variable} ${mono.variable} antialiased`}>
      <body className="min-h-dvh">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delay={200}>{children}</TooltipProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
