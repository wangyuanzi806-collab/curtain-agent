begin;

-- 颜色和谐推荐所需的数值字段。
-- color_name / color_family 是人可读分类（见 20260729031415），这里补的是计算用的量：
-- 冷暖同向、明度关系、彩度是否抢戏都要靠 CIELAB 数值判断，色系枚举做不到。
alter table public.sku_material
  add column if not exists color_lab_l numeric,
  add column if not exists color_lab_a numeric,
  add column if not exists color_lab_b numeric,
  add column if not exists color_chroma numeric,
  add column if not exists color_rgb text,
  add column if not exists pattern_contrast numeric,
  add column if not exists color_source text,
  add column if not exists color_extracted_at timestamptz;

comment on column public.sku_material.color_lab_l is 'CIELAB 明度 L*，0-100，由白底商品图提取';
comment on column public.sku_material.color_lab_a is 'CIELAB a* 轴（绿-红）';
comment on column public.sku_material.color_lab_b is 'CIELAB b* 轴（蓝-黄），正值偏暖';
comment on column public.sku_material.color_chroma is '彩度 C* = sqrt(a^2+b^2)，用于拦截极端色';
comment on column public.sku_material.pattern_contrast is '主次色簇的色度差（已剔除明度分量），用于识别高对比图案';
comment on column public.sku_material.color_source is 'extracted=图像提取 / supplier=供应商填报 / override=人工修正';

create index if not exists sku_material_harmony_lab_idx
  on public.sku_material (color_lab_l, color_lab_b, color_chroma)
  where status = 'active';

-- 和谐候选：硬约束过滤 + 软惩罚打分。
-- 色域区间由应用层按房间色彩算好后传入，本函数只负责筛选与评分。
create or replace function public.harmony_candidates(
  b_lo numeric, b_hi numeric,
  l_lo numeric, l_hi numeric,
  c_soft numeric,
  p_material text default 'main',
  c_hard numeric default 30,
  p_limit int default 400
)
returns table (
  factory_sku text,
  color_lab_l numeric, color_lab_a numeric, color_lab_b numeric,
  color_chroma numeric, color_family text, color_rgb text,
  texture_type text, weight_gsm numeric, composition text,
  penalty numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.factory_sku,
         m.color_lab_l, m.color_lab_a, m.color_lab_b,
         m.color_chroma, m.color_family, m.color_rgb,
         m.texture_type, m.weight_gsm, m.composition,
         round(
           greatest(0, (l_lo - m.color_lab_l) / 10.0)
         + greatest(0, (m.color_lab_l - l_hi) / 10.0)
         + greatest(0, (m.color_chroma - c_soft) / 8.0)
         + abs(m.color_lab_b - (b_lo + b_hi) / 2.0)
           / greatest(4, b_hi - b_lo) * 0.5
         , 2) as penalty
  from public.sku_material m
  where m.status = 'active'
    and m.material_type = p_material
    and m.color_lab_l is not null
    -- 硬约束一：冷暖底调必须同向。撞了是错，不是不够好
    and m.color_lab_b between b_lo and b_hi
    -- 硬约束二：彩度不得超硬上限，拦芥末黄这类抢戏色
    and m.color_chroma <= c_hard
    -- 硬约束三：明度是软约束，只在极端偏离时才排除
    and m.color_lab_l between (l_lo - 25) and (l_hi + 10)
  order by penalty, m.factory_sku
  limit p_limit;
$$;

-- 分层多样化：在合格候选里按「色族 × 明度档 × 肌理」分桶轮取。
-- 直接按 penalty 排序会选出彼此最像的几款（都挤在色域中心），
-- 实测前 5 款明度跨度仅 1.1；分层轮取后为 14.5。
create or replace function public.diversified_candidates(
  b_lo numeric, b_hi numeric,
  l_lo numeric, l_hi numeric,
  c_soft numeric,
  p_material text default 'main',
  c_hard numeric default 30,
  p_limit int default 24
)
returns table (
  factory_sku text, color_lab_l numeric, color_lab_b numeric,
  color_chroma numeric, color_family text, color_rgb text,
  value_level text, texture_type text, weight_gsm numeric,
  composition text, penalty numeric, bucket_rank int
)
language sql
stable
security invoker
set search_path = public
as $$
  with cand as (
    select h.*,
           case when h.color_lab_l < 45 then 'deep'
                when h.color_lab_l < 70 then 'mid'
                when h.color_lab_l < 85 then 'light'
                else 'pale' end as vlevel,
           split_part(h.factory_sku, '-', 1) as series
    from public.harmony_candidates(b_lo, b_hi, l_lo, l_hi, c_soft, p_material, c_hard, 4000) h
  ),
  -- 同系列只留最贴合的一款，避免候选池被一个花型的十个色号占满
  per_series as (
    select distinct on (series) * from cand order by series, penalty, factory_sku
  ),
  bucketed as (
    select *, row_number() over (
      partition by color_family, vlevel, texture_type order by penalty, factory_sku
    )::int as rn
    from per_series
  )
  select factory_sku, color_lab_l, color_lab_b, color_chroma, color_family, color_rgb,
         vlevel, texture_type, weight_gsm, composition, penalty, rn
  from bucketed
  order by rn, penalty, factory_sku
  limit p_limit;
$$;

commit;
