export type AdminActionMessage = {
  tone: "error" | "success";
  text: string;
};

export default function AdminActionFeedback({ message }: { message: AdminActionMessage | null }) {
  if (!message) return null;

  return (
    <div
      aria-live="polite"
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
        message.tone === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      {message.text}
    </div>
  );
}
