-- 这一场已经自动叫过哪些人。
--
-- 抑制重复是这套机制能不能活下来的关键：顾客一句话里同时问了价格和交期，
-- 或者他隔两轮又问一次价格，如果每次都发，店员两天之内就学会无视黄卡了——
-- 到那时连真正紧急的红卡也一起失效。所以每一类每场只叫一次。
--
-- 记在会话上而不是内存里：Vercel 上每个请求可能落在不同实例，
-- 内存里的「已发过」在下一个请求就没了。

alter table voice_sessions
  add column if not exists handoffs jsonb not null default '[]'::jsonb;
