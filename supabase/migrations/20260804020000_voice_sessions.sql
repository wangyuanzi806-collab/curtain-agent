-- 语音会话的持久记录。
--
-- 为什么要独立于 consultations:两者回答的是不同的问题。
--   consultations = 这位顾客的**业务档案**(房间照片、推荐方案、选中款、效果图、状态),
--                   业务人员按它跟线索。
--   voice_sessions = 一次接待的**过程记录**(逐轮说了什么、点了什么、多久)。
-- 一位顾客第二天回店,是同一条 consultation、第二场 session。把过程塞进
-- consultations.preferences 会让那个 jsonb 无限膨胀,而它每次推荐都要整读整写。
--
-- 只存文字转录,不存音频:音频是顾客的声音,存下来是完全不同量级的隐私承诺,
-- 而店里真正要回看的是「他当时说了什么」。
--
-- 状态由内容和时间决定,没有「结束」按钮——门店里让人去点的按钮必然形同虚设。

create table if not exists voice_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  advisor_user_id uuid,
  consultation_id uuid references consultations(id) on delete set null,
  -- 串起 voice_logs:铸凭证、工具调用、违禁词命中都带着这个标签
  session_label text,
  -- store = 门店语音页发起;backoffice = 业务人员在后台点开旧线索继续
  source text not null default 'store',
  -- [{role, text, at}] 逐轮追加。role: user | assistant | tool
  transcript jsonb not null default '[]'::jsonb,
  -- [{kind, id, label, at}] 顾客在屏幕上点过的
  taps jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 列表按「本组织最近活动」翻,这是唯一的高频查询
create index if not exists voice_sessions_org_active_idx
  on voice_sessions (organization_id, last_active_at desc);
create index if not exists voice_sessions_consultation_idx
  on voice_sessions (consultation_id);

alter table voice_sessions enable row level security;

-- 与 consultations 同样的边界:服务端用 service_role 走,匿名一律无权。
-- 不给 anon 任何权限(项目铁律)。
revoke all on voice_sessions from anon;
