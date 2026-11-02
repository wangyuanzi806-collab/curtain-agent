import type { Metadata } from "next";
import VoiceConsole from "@/components/royalzen/voice-console";

export const metadata: Metadata = {
  title: "语音顾问 · RoyalZen"
};

export const dynamic = "force-dynamic";

export default function VoicePage() {
  return <VoiceConsole localPreview={process.env.LOCAL_DEMO_PREVIEW === "1" && !process.env.VERCEL} />;
}
