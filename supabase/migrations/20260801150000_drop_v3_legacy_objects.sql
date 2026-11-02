-- 删除线下语音销售助手 07-31 迁库前留在本库的 5 个遗留对象。
-- 对方 2026-08-01 来信确认：是它的、可以删、不需回捞（drape-voice 里同名对象是当前真源）。
-- 本产品代码零引用，migration 从未创建过它们。
-- 不用 cascade：没有任何对象依赖它们，若报错说明有意外依赖，应当停下来看。
-- 备份在 .local/v3-backup-2026-08-01/（未进版本库，v3_config 含对方的 OpenAI 密钥）。
drop view if exists public.v3_kb_available;
drop view if exists public.v3_price_bands;
drop table if exists public.v3_voice_logs;
drop table if exists public.v3_orientation_figures;
drop table if exists public.v3_config;
