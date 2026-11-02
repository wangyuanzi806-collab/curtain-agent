-- voice_kb_available 把 verification 写成了常量，于是每一条都告诉助手
-- 「自动清洗、未经人工核验」——包括老板那本《比利时窗帘门店·遮光讲解与服务
-- 标准化执行手册 V2.0》抄进来的 9 条（KB-SOP-BL-*，human_verified = true，
-- 入库时以 knowledge_admin 身份显式声明、依据写在 review_note 里）。
--
-- 这一列是**整行返回给模型的**（runSearchKnowledge 的 entries）。结果是助手
-- 回答遮光时，手上唯一的权威依据被标成没人核验过，只会让它更保守、更容易
-- 推给同事——正好和手册「统一口径、透明展示」的意图相反。
--
-- 改成按底表的 human_verified 派生。**筛选条件一个字不动**：
-- 放行规则故意不看 status / active / approved_for_customer（看了就是 0 条，
-- 那批清洗产物在数据模型上是「草稿、未批准给顾客」），这个错位是已知且刻意的，
-- 记在 2026-08-02 的入库说明里，不在本次修改范围内。
create or replace view public.voice_kb_available as
  select
    knowledge_id,
    content_short,
    question_variants,
    locale_scope,
    case
      when human_verified then 'human_verified'
      else 'auto_cleaned_not_human_verified'
    end::text as verification
  from curtain_kb_entries e
  where audience = 'candidate_customer'::text
    and dataset_kind = 'formal'::text
    and (valid_until is null or valid_until > now())
    and not risk_tags && array[
      'manipulative_sales'::text,
      'installation_or_load'::text,
      'measurement_or_formula'::text,
      'price_or_promotion'::text,
      'legal_or_certification'::text,
      'health_or_chemical'::text,
      'market_or_locale_mismatch'::text
    ];
