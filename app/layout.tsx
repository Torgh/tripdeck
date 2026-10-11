import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SyncAgent } from "@/components/SyncAgent";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripDeck",
  description: "AI-assisted trip planner with drag-and-drop days, routes, dives and bookings.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "TripDeck", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0e7490",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
        <SyncAgent />
      </body>
    </html>
  );
}
