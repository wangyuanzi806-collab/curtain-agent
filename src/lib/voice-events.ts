/**
 * 屏幕事件 → 注入对话的载荷。前端(voice-console)和对话测试台共用**同一份**。
 *
 * 为什么抽出来:老板 08-05 的验收标准之一是「点击了图片,助手要立刻停下来,
 * 没说完的话不要继续往下说」。这要求每个事件带三个决定——
 *   interrupt:要不要掐断正在说的话(response.cancel)
 *   respond:  要不要立刻让它开口("now") / 只在它沉默时推一下("ifSilent") / 不推("no")
 *   text:     注入的旁白(方括号第三人称,realtime 没有系统旁白这一档)
 * 这三个决定散在组件各处时,测试台测不到真实行为;收在这里,测试台跑的
 * 就是线上那份逻辑。
 */

export type VoiceEvent =
  | { type: "tap_product"; facts: string; off: boolean; shotDone: boolean }
  | { type: "tap_choice"; spoken: string; isAny: boolean }
  | { type: "tap_room_photo" }
  | { type: "render_started"; color: string }
  | { type: "render_done"; color: string; image?: string }
  | { type: "render_failed" }
  | {
      type: "photo_received";
      image?: string;
      room: { wall: string; floor: string; undertone: string; guidance: string } | null;
    }
  | { type: "idle"; seconds: number; screen: string; nth: number };

export type EventPayload = {
  text: string;
  interrupt: boolean;
  respond: "now" | "ifSilent" | "no";
};

export function voiceEventPayload(evt: VoiceEvent): EventPayload {
  switch (evt.type) {
    case "tap_product":
      /*
       * 点中一款是整场里最热的那一刻。打断:他已经在看别的了,把上一句念完
       * 是在跟空气说话。下一步分两条路,走错一条就白费(详见各分支)。
       */
      return {
        interrupt: true,
        respond: "now",
        text: evt.off
          ? "[The customer just unselected that one on screen. Do not push it; ask what " +
            "was not right about it, or move to another.]"
          : `[The customer just tapped this one on screen: ${evt.facts}. That is the one he is ` +
            "looking at — talk about THIS one now, in his language, and say why it suits " +
            "what he told you. This also tells you his taste: lean that way from here on. " +
            (evt.shotDone
              ? "**Offer to show him how it looks in his own room — do not wait to be asked.** " +
                "He does not know that is possible. 'Want to see it up in your room? " +
                "About twenty seconds.'"
              : "There is no photo of his room yet, so the preview cannot be made. Tell him " +
                "plainly what he would get and what it costs him: 'if you take one photo of " +
                "that room, I can hang this fabric in it and show you.' **Say out loud that " +
                "without a photo there is no picture** — do not leave him waiting for one " +
                "that will never come. If he says no, drop it, keep talking about the fabric, " +
                "and you may mention it once more later. Never ask twice in a row.")
      };
    case "tap_choice":
      return {
        interrupt: true,
        respond: "now",
        /*
         * 「我也说不好」不是没回答,是**选了「你帮我定」**。分开写是因为它要的
         * 后续完全相反:普通选项要顺着往下收窄,这一张要助手自己拿主意,
         * 并且这道题从此不许再问——换个说法再问一遍,正是让人觉得自己蠢的问法。
         */
        text: evt.isAny
          ? "[The customer tapped 'I couldn't say — you pick'. That IS an answer: he is " +
            "handing this one to you. **Never ask this question again, in any wording.** " +
            "Say what you will do instead ('then I'll go by the colours in your room'), " +
            "in one short sentence in his language, and move on.]"
          : `[The customer just tapped on the screen: ${evt.spoken}. That is his answer — ` +
            "use it, do not ask the same thing again in other words. Acknowledge it in one " +
            "short sentence, in his language, then move on.]"
      };
    case "tap_room_photo":
      return {
        interrupt: true,
        respond: "now",
        text:
          "[The customer just tapped the photo of his room — he wants to hear what you make " +
          "of it. Say what you see in it (the colours you were given), in his language, as " +
          "your own reading. Never say you cannot see it. Then one question about how he " +
          "uses the room.]"
      };
    case "render_started":
      // 不打断、不催:它正该继续讲这块布,半分钟的沉默看起来就是坏了
      return {
        interrupt: false,
        respond: "ifSilent",
        text:
          `[The salesperson is generating a preview of the ${evt.color || "selected"} fabric ` +
          "installed in this customer's own room. It takes about half a minute. Do NOT go silent " +
          "and do NOT announce the render as if it were your doing — keep talking about that " +
          "fabric: how it hangs, what it does for their light, what they told you it is for.]"
      };
    case "render_done":
      /*
       * 图出现在屏幕上的那一刻,真人会停下手里的话:「出来了——您看」。
       * 所以打断。图本身随事件注入(input_image),它是真的看得见,
       * 说的必须是图里有的东西,不是一段通用赞美。
       */
      return {
        interrupt: true,
        respond: "now",
        text:
          "[The preview is ready and ON SCREEN — the picture is attached, look at it. " +
          "React to what you actually see in HIS room: where the fabric catches the light, " +
          "how it sits with his wall and floor. ONE short sentence, in his language, then let " +
          "him look. If he sounds pleased, this is the moment to offer the next real step — " +
          "a colleague can measure the window (escalate_to_staff, wants_human) — offer once, " +
          "only act on a yes.]"
      };
    case "render_failed":
      return {
        interrupt: false,
        respond: "ifSilent",
        text:
          "[The preview did not come out. Never mention a failure or anything technical — " +
          "the picture is simply taking longer than it should. Keep going with the fabric " +
          "itself; the salesperson can tap it again.]"
      };
    case "photo_received":
      // 和顾问自己拍那条同一套口径:第一人称,绝不说自己看不到
      return {
        interrupt: true,
        respond: "now",
        text: evt.room
          ? "[The customer just sent a photo of his room from his own phone — it is on the " +
            `screen now and attached here. Walls ${evt.room.wall}, floor ${evt.room.floor}, ` +
            `overall undertone ${evt.room.undertone}. ${evt.room.guidance} Say that reading in ` +
            "the first person, as your own ('your walls are a warm off-white'), never mention " +
            "any analysis and never say you cannot see it. Thank him in half a sentence, " +
            "no more — then one question about how he uses the room.]"
          : "[The customer just sent a photo of his room from his own phone; it is on the screen " +
            "and saved with the consultation. Say what you see in it in the first person, " +
            "briefly; if the photo is not attached here, do not describe colours and do not " +
            "guess. Thank him briefly and ask one question about how he uses that room. " +
            "Never say you cannot see the photo.]"
      };
    case "idle":
      /*
       * 顾客沉默 = 球掉在地上。老板 08-05 纠偏:**安静不是目标,冷场是失败**。
       * 真人销售这时会把球捡起来递回去——说一句关于他正在看的东西的短话,
       * 末尾留一个低门槛的话头让他有话可接;他两次不接,第三次就换成给一条
       * 具体的路(拍照/摸样品/叫人),给他留下来的理由,不是给他一片安静。
       */
      return {
        interrupt: false,
        respond: "now",
        text:
          evt.nth >= 3
            ? `[Still quiet (~${evt.seconds}s). On screen: ${evt.screen}. Your remarks did not land, ` +
              "so stop remarking — offer ONE concrete next step instead, the most natural one for " +
              "what is on screen: a photo of his room to see a fabric hanging there, feeling the " +
              "real sample, or a colleague. One short sentence, one offer, in his language. " +
              "If he passes on that too, let him browse — do not stack offers.]"
            : `[He has been quiet for about ${evt.seconds} seconds. On screen right now: ${evt.screen}. ` +
              "Pick the ball up and hand it back: ONE short remark about what he is looking at, " +
              "ending in an easy opening he can answer with three words — about his room, his " +
              "light, who uses it. Not a fact dump, not a summary, never 'are you still there'. " +
              "Dead air is your failure, not politeness.]"
      };
  }
}

/**
 * wait_for_user 是本地工具:没有服务端要跑的活,它的意义是让「不打断顾客的动作」
 * 成为模型能选的行为。**只用于他正在动作中**(读卡片/比图/扫码)——冷场不是
 * 它的适用场景,冷场要捡球(见 idle 事件)。结果原样回给模型,不接 response.create。
 */
export function waitForUserOutput() {
  return {
    ok: true,
    guidance:
      "Good — he is mid-action, let him finish it. The moment he speaks, taps, or something " +
      "new lands on screen, you are on again."
  };
}
