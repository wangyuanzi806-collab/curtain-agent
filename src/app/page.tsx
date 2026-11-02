import { redirect } from "next/navigation";

export default function HomePage() {
  redirect(process.env.LOCAL_DEMO_PREVIEW === "1" && !process.env.VERCEL ? "/share/demo" : "/app");
}
