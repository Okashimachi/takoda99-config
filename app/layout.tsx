import type { Metadata } from "next";
import "./globals.css";
import { Chrome } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "たこ焼き99 運営コンソール",
  description: "Takoda99 のゲームバランスとお題を調整する管理UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
