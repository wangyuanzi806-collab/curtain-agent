import type { Metadata } from "next";
import VoiceInterpreter from "@/components/royalzen/voice-interpreter";

export const metadata: Metadata = {
  title: "现场传译 · RoyalZen"
};

export const dynamic = "force-dynamic";

export default function VoiceTranslatePage() {
  return <VoiceInterpreter />;
}
