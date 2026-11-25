import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import AppFrame from "../../components/AppFrame";
import "./behave.css";

export const metadata: Metadata = {
  title: "Behave",
  description: "A small city that grows or stalls with how you actually live: screens, food, sleep and movement.",
  manifest: "/behave/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Behave", statusBarStyle: "default" },
  icons: { apple: "/behave/icon-180.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f5f1ea" };

export default function BehaveLayout({ children }: { children: ReactNode }) {
  return (
    <AppFrame name="Behave" fill>
      <div className="bh">{children}</div>
    </AppFrame>
  );
}
