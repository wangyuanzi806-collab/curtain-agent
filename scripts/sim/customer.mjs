/** 顾客扮演器:gpt-5.5 按人设卡决定每一轮做什么(说/点/沉默/走) */
import { personaPrompt } from "./personas.mjs";

export async function customerAct({ apiKey, persona, variantIndex, transcript, screenDesc, turnNo }) {
  const history = transcript
    .map((t) => {
      if (t.role === "assistant") return `助手: ${t.text}`;
      if (t.role === "user") return `你: ${t.text}`;
      return `(${t.text})`; // 你的动作、屏幕变化
    })
    .join("\n");

  const body = {
    model: "gpt-5.5",
    // 扮顾客不需要深度推理:低档就够,快十倍
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: personaPrompt(persona, variantIndex) },
      {
        role: "user",
        content:
          `【对话到现在】\n${history || "(还没开始,助手马上开口)"}\n\n` +
          `【屏幕上现在有】${screenDesc || "什么都没有"}\n\n` +
          `【这是你的第 ${turnNo} 次行动】输出你的下一步 JSON。`
      }
    ]
  };
  // 没有超时的 fetch 挂一次,整场就永远停在那里——后台跑批栽过
  const call = () =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    });
  let response;
  try {
    response = await call();
  } catch {
    response = await call(); // 超时/断连重试一次
  }
  const data = await response.json();
  if (!response.ok) throw new Error(`customer model: ${JSON.stringify(data).slice(0, 200)}`);
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { action: "say", text: "嗯。" }; // 坏 JSON 当一句敷衍,别断场
  }
}
