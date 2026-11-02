import "server-only";

import { getDb } from "@/lib/db";
import type { WorkspaceActor } from "@/lib/platform-db";

/**
 * 一场语音接待的过程记录。
 *
 * 与 consultation 的分工:consultation 是这位顾客的**档案**(照片、推荐、效果图、
 * 状态),session 是这一次接待的**过程**(逐轮说了什么、点了什么)。
 * 顾客第二天回店 = 同一条 consultation 的第二场 session。
 *
 * 为什么必须落库:今天的转录只活在浏览器内存里,顾问一关页面就没了。
 * 于是「刚才那位客人说要给儿童房换个厚一点的」这种最值钱的信息,
 * 第二天没有任何人找得回来。业务人员跟线索时看到的只有五张布的图。
 *
 * **写失败绝不能弄断通话**:所有写入都 catch 掉。屏幕上顾客正看着,
 * 一个存档失败的报错在他面前弹出来是当场事故。
 */

export type TranscriptTurn = { role: "user" | "assistant" | "tool"; text: string; at: string };
export type SessionTap = { kind: string; id: string; label: string; at: string };

export type VoiceSessionRow = {
  id: string;
  consultationId: string | null;
  sessionLabel: string | null;
  source: string;
  transcript: TranscriptTurn[];
  taps: SessionTap[];
  /** 这一场已经自动叫过哪些人。每类只叫一次，见 markHandoff */
  handoffs: string[];
  startedAt: string;
  lastActiveAt: string;
};

/** 一场对话最多留这么多轮。门店一场十几分钟,几十轮足够;上不封顶会让 jsonb 变成炸弹 */
const MAX_TURNS = 400;

function mapRow(row: Record<string, unknown>): VoiceSessionRow {
  return {
    id: String(row.id),
    consultationId: row.consultation_id ? String(row.consultation_id) : null,
    sessionLabel: row.session_label ? String(row.session_label) : null,
    source: String(row.source ?? "store"),
    transcript: Array.isArray(row.transcript) ? (row.transcript as TranscriptTurn[]) : [],
    taps: Array.isArray(row.taps) ? (row.taps as SessionTap[]) : [],
    handoffs: Array.isArray(row.handoffs) ? (row.handoffs as string[]) : [],
    startedAt: new Date(String(row.started_at)).toISOString(),
    lastActiveAt: new Date(String(row.last_active_at)).toISOString()
  };
}

export async function openVoiceSession(
  actor: WorkspaceActor,
  input: { sessionLabel?: string | null; source?: string; consultationId?: string | null }
): Promise<VoiceSessionRow | null> {
  try {
    const result = await getDb().query(
      `insert into voice_sessions (organization_id, advisor_user_id, consultation_id, session_label, source)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [
        actor.organizationId,
        actor.authUserId,
        input.consultationId || null,
        input.sessionLabel || null,
        input.source === "backoffice" ? "backoffice" : "store"
      ]
    );
    return mapRow(result.rows[0]);
  } catch (error) {
    console.warn("[voice] openVoiceSession failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 追加几轮对话。
 *
 * 用 `jsonb ||` 在库里拼,不是读出来改再写回:两个标签页、或者一次重连撞上一次
 * 追加,读改写会让先到的那几轮凭空消失。
 * 超长时在库里裁剪,保留最近 MAX_TURNS 轮。
 */
export async function appendTurns(
  actor: WorkspaceActor,
  sessionId: string,
  turns: TranscriptTurn[]
): Promise<void> {
  if (!turns.length) return;
  try {
    await getDb().query(
      `update voice_sessions
         set transcript = (
               select coalesce(jsonb_agg(t), '[]'::jsonb)
                 from (
                   select value as t
                     from jsonb_array_elements(transcript || $3::jsonb)
                       with ordinality as x(value, ord)
                    order by ord
                    offset greatest(0, jsonb_array_length(transcript || $3::jsonb) - $4)
                 ) kept
             ),
             last_active_at = now()
       where id = $1 and organization_id = $2`,
      [sessionId, actor.organizationId, JSON.stringify(turns), MAX_TURNS]
    );
  } catch (error) {
    console.warn("[voice] appendTurns failed", error instanceof Error ? error.message : error);
  }
}

export async function appendTap(
  actor: WorkspaceActor,
  sessionId: string,
  tap: SessionTap
): Promise<void> {
  try {
    await getDb().query(
      `update voice_sessions
          set taps = taps || $3::jsonb, last_active_at = now()
        where id = $1 and organization_id = $2`,
      [sessionId, actor.organizationId, JSON.stringify([tap])]
    );
  } catch (error) {
    console.warn("[voice] appendTap failed", error instanceof Error ? error.message : error);
  }
}

/**
 * 记下「这一类已经叫过人了」，并回答「刚才是不是我第一个记上的」。
 *
 * 判重必须在库里做，不能先读再写：两条转录几乎同时到达时，读改写会让两边
 * 都看到「还没叫过」，于是同一件事发两张卡。用带条件的 update + returning，
 * 抢到的那次才拿得到行。
 */
export async function markHandoff(
  actor: WorkspaceActor,
  sessionId: string,
  reason: string
): Promise<boolean> {
  try {
    const result = await getDb().query(
      `update voice_sessions
          set handoffs = handoffs || $3::jsonb, last_active_at = now()
        where id = $1 and organization_id = $2
          and not (handoffs ? $4)
        returning id`,
      [sessionId, actor.organizationId, JSON.stringify([reason]), reason]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    // 记不上就当已经叫过——**宁可漏一次，不要重复轰炸**。
    // 店员对同一件事收到两张卡，比收不到更快学会无视全部。
    console.warn("[voice] markHandoff failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/** 会话开出来时还没有咨询单，第一次真有产出才补挂上去 */
export async function attachConsultation(
  actor: WorkspaceActor,
  sessionId: string,
  consultationId: string
): Promise<void> {
  try {
    await getDb().query(
      `update voice_sessions
          set consultation_id = $3, last_active_at = now()
        where id = $1 and organization_id = $2 and consultation_id is null`,
      [sessionId, actor.organizationId, consultationId]
    );
  } catch (error) {
    console.warn("[voice] attachConsultation failed", error instanceof Error ? error.message : error);
  }
}

export async function listVoiceSessions(
  actor: WorkspaceActor,
  limit = 20
): Promise<(VoiceSessionRow & { clientName: string; displayCode: string; sceneImageUrl: string | null; pickCount: number })[]> {
  try {
    const result = await getDb().query(
      `select s.*,
              c.client_name,
              c.display_code,
              c.scene_image_url,
              coalesce(jsonb_array_length(c.recommendation -> 'skus'), 0) as pick_count
         from voice_sessions s
         left join consultations c on c.id = s.consultation_id
        where s.organization_id = $1
          -- 点了球没说话就走的空场次不该占据列表
          and (jsonb_array_length(s.transcript) > 0 or s.consultation_id is not null)
        order by s.last_active_at desc
        limit $2`,
      [actor.organizationId, limit]
    );
    return result.rows.map((row) => ({
      ...mapRow(row),
      clientName: String(row.client_name ?? "未记名"),
      displayCode: String(row.display_code ?? ""),
      sceneImageUrl: row.scene_image_url ? String(row.scene_image_url) : null,
      pickCount: Number(row.pick_count ?? 0)
    }));
  } catch (error) {
    console.warn("[voice] listVoiceSessions failed", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getVoiceSession(
  actor: WorkspaceActor,
  sessionId: string
): Promise<VoiceSessionRow | null> {
  try {
    const result = await getDb().query(
      `select * from voice_sessions where id = $1 and organization_id = $2 limit 1`,
      [sessionId, actor.organizationId]
    );
    return result.rowCount ? mapRow(result.rows[0]) : null;
  } catch {
    return null;
  }
}

/** 某条咨询单下的全部会话，后台详情页按时间正序展示 */
export async function listSessionsForConsultation(
  actor: WorkspaceActor,
  consultationId: string
): Promise<VoiceSessionRow[]> {
  try {
    const result = await getDb().query(
      `select * from voice_sessions
        where consultation_id = $1 and organization_id = $2
        order by started_at asc`,
      [consultationId, actor.organizationId]
    );
    return result.rows.map(mapRow);
  } catch {
    return [];
  }
}

/**
 * 把上一场压成一段能塞进新会话的交底。
 *
 * 不是原样回放全部转录——那既贵又让模型抓不住重点。顾问要的是
 * 「上次聊到哪、他要什么、给他看过什么」,所以取:顾客说过的话(全部)、
 * 点过的选项、助手最后几句。
 */
export function briefFromSession(session: VoiceSessionRow): string {
  const saidByCustomer = session.transcript
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text.trim())
    .filter(Boolean);
  const tapped = session.taps.map((tap) => tap.label);
  const lastFromAssistant = session.transcript
    .filter((turn) => turn.role === "assistant")
    .slice(-3)
    .map((turn) => turn.text.trim())
    .filter(Boolean);

  const parts: string[] = [];
  if (saidByCustomer.length) parts.push(`The customer said: ${saidByCustomer.join(" / ")}`);
  if (tapped.length) parts.push(`They picked on screen: ${tapped.join(", ")}`);
  if (lastFromAssistant.length) parts.push(`You last said: ${lastFromAssistant.join(" / ")}`);
  return parts.join("\n");
}
