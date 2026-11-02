import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { GenerationRecord } from "@/lib/curtain-types";

type CreateGenerationInput = {
  prompt: string;
  userInstruction: string;
  sceneR2Key: string | null;
  curtainR2Key: string | null;
  referenceR2Keys: string[];
  agentRequestedModel: string | null;
  agentUsedProvider: string | null;
  agentUsedModel: string | null;
  agentAttemptModels: string[];
  recommendedSkuIds: string[];
  selectedSkuId: string | null;
  selectedSkuName: string | null;
};

type SuccessInput = {
  resultImageUrl: string;
  resultR2Key: string | null;
  providerResponse: unknown;
  providerRequest: unknown;
};

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;
const STALE_GENERATION_TIMEOUT_MINUTES = 8;
const STALE_GENERATION_MESSAGE = "\u4efb\u52a1\u8d85\u8fc7\u9884\u671f\u65f6\u95f4\u4ecd\u672a\u5b8c\u6210\uff0c\u7cfb\u7edf\u5df2\u81ea\u52a8\u6807\u8bb0\u4e3a\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u751f\u6210\u3002";

export function shouldRunRuntimeSchemaSetup() {
  const configured = process.env.RUNTIME_SCHEMA_SETUP;
  if (configured === "1") return true;
  if (configured === "0") return false;
  return !process.env.VERCEL;
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mapRow(row: Record<string, unknown>): GenerationRecord {
  return {
    id: String(row.id),
    status: String(row.status),
    prompt: String(row.prompt),
    userInstruction: (row.user_instruction as string | null) ?? null,
    sceneR2Key: (row.scene_r2_key as string | null) ?? null,
    curtainR2Key: (row.curtain_r2_key as string | null) ?? null,
    referenceR2Keys: Array.isArray(row.reference_r2_keys) ? (row.reference_r2_keys as string[]) : [],
    resultImageUrl: (row.result_image_url as string | null) ?? null,
    resultR2Key: (row.result_r2_key as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    providerModel: String(row.provider_model),
    agentRequestedModel: (row.agent_requested_model as string | null) ?? null,
    agentUsedProvider: (row.agent_used_provider as string | null) ?? null,
    agentUsedModel: (row.agent_used_model as string | null) ?? null,
    agentAttemptModels: Array.isArray(row.agent_attempt_models) ? (row.agent_attempt_models as string[]) : [],
    recommendedSkuIds: Array.isArray(row.recommended_sku_ids) ? (row.recommended_sku_ids as string[]) : [],
    selectedSkuId: (row.selected_sku_id as string | null) ?? null,
    selectedSkuName: (row.selected_sku_name as string | null) ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

/**
 * 连接被中间层悄悄掐断的几种说法。
 *
 * Serverless 上这事很常见：池里那个 client 已经死了，但直到被取出来用才发现。
 * 表现是「偶尔一次 500，刷新就好」——2026-08-03 老板在手机上登录时撞到过，
 * 屏幕上只有一句 Application error 和一个 digest，查不出任何东西。
 */
const CONNECTION_LOST =
  /ECONNRESET|socket hang up|Connection terminated|SSL routines|server closed the connection|Client has encountered a connection error/i;

function isConnectionLost(error: unknown) {
  return error instanceof Error && CONNECTION_LOST.test(error.message);
}

/**
 * Supabase 的 session-mode pooler 把名额用光了。
 *
 * 报错原文：(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15
 *
 * 这 15 个名额是**整个数据库全局**的，不是每个函数实例各有 15 个。serverless 上
 * 每个实例都建自己的池，用完还要按 idleTimeoutMillis 占着不放——几个实例一叠加就满了。
 * 表现是「第一次点必失败，第二次就好」：第一次要新建连接，撞上满池直接被拒；
 * 这一拒反而让本实例的池被回收，名额还回去了，第二次就挤得进来。
 *
 * 所以这类错误和"连接断了"不一样：不是本地坏了，是全局挤不进去。
 * 重试要给别的实例留出归还时间，光换个新池是不够的。
 */
const POOL_EXHAUSTED = /max clients reached|MaxClientsInSessionMode|EMAXCONNSESSION/i;

function isPoolExhausted(error: unknown) {
  return error instanceof Error && POOL_EXHAUSTED.test(error.message);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 包装 pool.query 后原始的那一份，重试时要用它，否则重试会一层套一层 */
type PatchedPool = Pool & { __rawQuery?: (...args: unknown[]) => Promise<unknown> };

export function getDb() {
  if (!pool) {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is missing.");
    }

    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false },
      // 名额是**整个数据库全局 15 个**，不是每个实例 15 个。而 serverless 上每个实例
      // 都建自己的池——池开多大，就等于一个实例占几个名额。开 3 个的话五个实例就满了。
      // 推荐链路是串行查的，一个连接足够；同实例内的并发查询会排队，慢一点但不会失败。
      max: envNumber("POSTGRES_POOL_MAX", 1),
      connectionTimeoutMillis: envNumber("POSTGRES_CONNECTION_TIMEOUT_MS", 20000),
      // 空闲连接压着不放就是在替别人占位。原先 60 秒：一次请求跑完还要再占一分钟。
      idleTimeoutMillis: envNumber("POSTGRES_IDLE_TIMEOUT_MS", 5_000),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      query_timeout: envNumber("POSTGRES_QUERY_TIMEOUT_MS", 30000),
      statement_timeout: envNumber("POSTGRES_STATEMENT_TIMEOUT_MS", 30000),
      allowExitOnIdle: true
    });

    pool.on("error", (error) => {
      console.warn("[db] idle client failed; recreating the pool", error.message);
      void resetDbPool();
    });

    // 池的 error 事件会重建池，但那是异步的——当前这次查询早就抛出去了，
    // 页面已经是 500。所以在查询这一层再兜一次。
    // SQL 写错了重试一百次也还是错的，所以只对这两类重试：
    //   连接失效  换个新池重来一次就行，是本地的连接坏了
    //   名额占满  换新池只还回本实例那几个，还得等别的实例也还，所以退避重试三次
    const runQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
    (pool as PatchedPool).__rawQuery = runQuery;
    pool.query = (async (...args: unknown[]) => {
      for (let attempt = 0; ; attempt += 1) {
        // 第一次用当前池；重试时新池的 query 已经被包过一层，取原始的那份免得递归
        const exec = attempt === 0 ? runQuery : ((getDb() as PatchedPool).__rawQuery as typeof runQuery);
        try {
          return await exec(...args);
        } catch (error) {
          const exhausted = isPoolExhausted(error);
          const maxAttempts = exhausted ? 4 : isConnectionLost(error) ? 1 : 0;
          if (attempt >= maxAttempts) throw error;
          console.warn(
            exhausted
              ? `[db] 连接名额已满，等一下重试（第 ${attempt + 1} 次）`
              : "[db] 连接已失效，换新池重试一次",
            (error as Error).message
          );
          if (exhausted) {
            // 占着名额的是**别的函数实例**，本地换新池一点忙都帮不上，
            // 反而白付一次握手。唯一有用的动作是等——等到某个实例的空闲连接
            // 超时归还。所以退避要盖得住 idleTimeoutMillis，退避太短等于没退。
            await sleep(700 * (attempt + 1));
          } else {
            await resetDbPool();
          }
        }
      }
    }) as typeof pool.query;
  }

  return pool;
}

export async function resetDbPool() {
  const stalePool = pool;
  pool = null;
  schemaPromise = null;
  if (stalePool) {
    await stalePool.end().catch(() => undefined);
  }
}

export async function pingDatabase() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await getDb().query("select 1");
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await resetDbPool();
    }
  }
}

export async function ensureSchema() {
  if (!shouldRunRuntimeSchemaSetup()) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getDb();
      await db.query(`
        create table if not exists curtain_generations (
          id text primary key,
          status text not null,
          prompt text not null,
          user_instruction text,
          scene_r2_key text,
          curtain_r2_key text,
          reference_r2_keys text[] not null default '{}',
          result_image_url text,
          result_r2_key text,
          provider_model text not null,
          provider_request jsonb,
          provider_response jsonb,
          error_message text,
          agent_requested_model text,
          agent_used_provider text,
          agent_used_model text,
          agent_attempt_models text[] not null default '{}',
          recommended_sku_ids text[] not null default '{}',
          selected_sku_id text,
          selected_sku_name text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create table if not exists curtain_skus (
          sku_id text primary key,
          name text not null,
          brand text,
          collection text,
          product_type text,
          opacity text,
          color text,
          mounting text,
          layer_type text,
          price_band text,
          style_tags text,
          window_types text,
          page_url text,
          image_url text,
          local_image text,
          source text,
          usage_note text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create table if not exists curtain_knowledge_docs (
          id text primary key,
          title text not null,
          category text not null default 'general',
          tags text not null default '',
          content text not null,
          source text not null default 'Manual',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create table if not exists curtain_styles (
          id text primary key,
          name text not null,
          name_en text not null default '',
          description text not null default '',
          description_en text not null default '',
          image_url text,
          suitable_windows text not null default '',
          recommended_scenes text not null default '',
          sort_order int not null default 0,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create table if not exists curtain_fabrics (
          id text primary key,
          name text not null,
          name_en text not null default '',
          description text not null default '',
          color text not null default '',
          material text not null default '',
          style_tags text not null default '',
          texture_url text,
          curtain_image_url text,
          sort_order int not null default 0,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      // 给 styles 加英文字段（已有表升级）
      await db.query(`
        alter table curtain_styles
        add column if not exists name_en text not null default '',
        add column if not exists description_en text not null default '',
        add column if not exists suitable_windows_en text not null default ''
      `);
      // 给 fabrics 加英文字段
      await db.query(`
        alter table curtain_fabrics
        add column if not exists description_en text not null default '',
        add column if not exists color_en text not null default '',
        add column if not exists material_en text not null default '',
        add column if not exists style_tags_en text not null default ''
      `);
      await db.query(`
        alter table curtain_generations
        add column if not exists agent_requested_model text,
        add column if not exists agent_used_provider text,
        add column if not exists agent_used_model text,
        add column if not exists agent_attempt_models text[] not null default '{}',
        add column if not exists recommended_sku_ids text[] not null default '{}',
        add column if not exists selected_sku_id text,
        add column if not exists selected_sku_name text
      `);
      await db.query(`
        alter table curtain_skus
        add column if not exists window_types text
      `);
    })().catch(async (error) => {
      // Supabase free instances can invalidate the first pool while waking up.
      // Do not cache that rejected promise for the lifetime of the function.
      await resetDbPool();
      throw error;
    });
  }

  await schemaPromise;
}

export async function expireStaleGenerations(timeoutMinutes = STALE_GENERATION_TIMEOUT_MINUTES) {
  const db = getDb();
  const result = await db.query(
    `
      update curtain_generations
      set
        status = 'failed',
        error_message = $1,
        updated_at = now()
      where status = 'processing'
        and updated_at < now() - make_interval(mins => $2::int)
      returning *
    `,
    [STALE_GENERATION_MESSAGE, timeoutMinutes]
  );

  return result.rows.map(mapRow);
}

export async function createGeneration(input: CreateGenerationInput) {
  const db = getDb();
  await expireStaleGenerations();
  const id = randomUUID();
  const model = process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128";
  const result = await db.query(
    `
      insert into curtain_generations (
        id,
        status,
        prompt,
        user_instruction,
        scene_r2_key,
        curtain_r2_key,
        reference_r2_keys,
        provider_model,
        agent_requested_model,
        agent_used_provider,
        agent_used_model,
        agent_attempt_models,
        recommended_sku_ids,
        selected_sku_id,
        selected_sku_name
      )
      values ($1, 'processing', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning *
    `,
    [
      id,
      input.prompt,
      input.userInstruction || null,
      input.sceneR2Key,
      input.curtainR2Key,
      input.referenceR2Keys,
      model,
      input.agentRequestedModel,
      input.agentUsedProvider,
      input.agentUsedModel,
      input.agentAttemptModels,
      input.recommendedSkuIds,
      input.selectedSkuId,
      input.selectedSkuName
    ]
  );

  return mapRow(result.rows[0]);
}

export async function createSucceededGeneration(input: CreateGenerationInput & SuccessInput) {
  const db = getDb();
  const id = randomUUID();
  const model = process.env.ARK_IMAGE_MODEL || "doubao-seedream-5-0-260128";
  const result = await db.query(
    `
      insert into curtain_generations (
        id,
        status,
        prompt,
        user_instruction,
        scene_r2_key,
        curtain_r2_key,
        reference_r2_keys,
        result_image_url,
        result_r2_key,
        provider_model,
        provider_request,
        provider_response,
        error_message,
        agent_requested_model,
        agent_used_provider,
        agent_used_model,
        agent_attempt_models,
        recommended_sku_ids,
        selected_sku_id,
        selected_sku_name
      )
      values ($1, 'succeeded', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, null, $12, $13, $14, $15, $16, $17, $18)
      returning *
    `,
    [
      id,
      input.prompt,
      input.userInstruction || null,
      input.sceneR2Key,
      input.curtainR2Key,
      input.referenceR2Keys,
      input.resultImageUrl,
      input.resultR2Key,
      model,
      JSON.stringify(input.providerRequest),
      JSON.stringify(input.providerResponse),
      input.agentRequestedModel,
      input.agentUsedProvider,
      input.agentUsedModel,
      input.agentAttemptModels,
      input.recommendedSkuIds,
      input.selectedSkuId,
      input.selectedSkuName
    ]
  );

  return mapRow(result.rows[0]);
}

export async function markGenerationSucceeded(id: string, input: SuccessInput) {
  const db = getDb();
  const result = await db.query(
    `
      update curtain_generations
      set
        status = 'succeeded',
        result_image_url = $2,
        result_r2_key = $3,
        provider_request = $4::jsonb,
        provider_response = $5::jsonb,
        error_message = null,
        updated_at = now()
      where id = $1
      returning *
    `,
    [id, input.resultImageUrl, input.resultR2Key, JSON.stringify(input.providerRequest), JSON.stringify(input.providerResponse)]
  );

  return mapRow(result.rows[0]);
}

export async function updateGenerationResultR2Key(id: string, resultR2Key: string) {
  const db = getDb();
  const result = await db.query(
    `
      update curtain_generations
      set result_r2_key = $2, updated_at = now()
      where id = $1
      returning *
    `,
    [id, resultR2Key]
  );

  return result.rowCount === 0 ? null : mapRow(result.rows[0]);
}

export async function markGenerationFailed(id: string, errorMessage: string) {
  const db = getDb();
  const result = await db.query(
    `
      update curtain_generations
      set status = 'failed', error_message = $2, updated_at = now()
      where id = $1
      returning *
    `,
    [id, errorMessage]
  );

  return mapRow(result.rows[0]);
}

export async function getGenerationById(id: string) {
  const db = getDb();
  await expireStaleGenerations();
  const result = await db.query(`select * from curtain_generations where id = $1 limit 1`, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function listRecentGenerations(limit = 10, offset = 0) {
  const db = getDb();
  const result = await db.query(
    `
      select
        id,
        case
          when status = 'processing'
            and updated_at < now() - make_interval(mins => $3::int)
          then 'failed'
          else status
        end as status,
        prompt,
        user_instruction,
        scene_r2_key,
        curtain_r2_key,
        reference_r2_keys,
        result_image_url,
        result_r2_key,
        case
          when status = 'processing'
            and updated_at < now() - make_interval(mins => $3::int)
          then coalesce(error_message, $4)
          else error_message
        end as error_message,
        provider_model,
        agent_requested_model,
        agent_used_provider,
        agent_used_model,
        agent_attempt_models,
        recommended_sku_ids,
        selected_sku_id,
        selected_sku_name,
        created_at,
        updated_at
      from curtain_generations
      order by created_at desc
      limit $1
      offset $2
    `,
    [limit, offset, STALE_GENERATION_TIMEOUT_MINUTES, STALE_GENERATION_MESSAGE]
  );
  return result.rows.map(mapRow);
}

// ==================== Curtain Styles ====================

export type CurtainStyle = {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  imageUrl: string | null;
  suitableWindows: string;
  suitableWindowsEn: string;
  recommendedScenes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

function mapStyleRow(row: Record<string, unknown>): CurtainStyle {
  return {
    id: String(row.id),
    name: String(row.name),
    nameEn: String(row.name_en ?? ""),
    description: String(row.description ?? ""),
    descriptionEn: String(row.description_en ?? ""),
    imageUrl: (row.image_url as string | null) ?? null,
    suitableWindows: String(row.suitable_windows ?? ""),
    suitableWindowsEn: String(row.suitable_windows_en ?? ""),
    recommendedScenes: String(row.recommended_scenes ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listStyles(limit = 2000, offset = 0) {
  const db = getDb();
  const result = await db.query(
    `
      select
        id,
        name,
        name_en,
        description,
        description_en,
        image_url,
        suitable_windows,
        suitable_windows_en,
        recommended_scenes,
        sort_order,
        created_at,
        updated_at
      from curtain_styles
      order by sort_order asc, created_at desc
      limit $1
      offset $2
    `,
    [limit, offset]
  );
  return result.rows.map(mapStyleRow);
}

export async function getStyleById(id: string) {
  const db = getDb();
  const result = await db.query(`select * from curtain_styles where id = $1 limit 1`, [id]);
  return result.rowCount === 0 ? null : mapStyleRow(result.rows[0]);
}

export async function upsertStyle(input: {
  id?: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  imageUrl?: string | null;
  suitableWindows?: string;
  recommendedScenes?: string;
  sortOrder?: number;
}) {
  const db = getDb();
  const id = input.id || randomUUID();
  const result = await db.query(
    `insert into curtain_styles (id, name, name_en, description, description_en, image_url, suitable_windows, recommended_scenes, sort_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       name = excluded.name,
       name_en = excluded.name_en,
       description = excluded.description,
       description_en = excluded.description_en,
       image_url = excluded.image_url,
       suitable_windows = excluded.suitable_windows,
       recommended_scenes = excluded.recommended_scenes,
       sort_order = excluded.sort_order,
       updated_at = now()
     returning *`,
    [id, input.name, input.nameEn ?? "", input.description ?? "", input.descriptionEn ?? "", input.imageUrl ?? null, input.suitableWindows ?? "", input.recommendedScenes ?? "", input.sortOrder ?? 0]
  );
  return mapStyleRow(result.rows[0]);
}

export async function deleteStyle(id: string) {
  const db = getDb();
  await db.query(`delete from curtain_styles where id = $1`, [id]);
}

// ==================== Curtain Fabrics ====================

export type CurtainFabric = {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  color: string;
  colorEn: string;
  material: string;
  materialEn: string;
  styleTags: string;
  styleTagsEn: string;
  textureUrl: string | null;
  curtainImageUrl: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

function mapFabricRow(row: Record<string, unknown>): CurtainFabric {
  return {
    id: String(row.id),
    name: String(row.name),
    nameEn: String(row.name_en ?? ""),
    description: String(row.description ?? ""),
    descriptionEn: String(row.description_en ?? ""),
    color: String(row.color ?? ""),
    colorEn: String(row.color_en ?? ""),
    material: String(row.material ?? ""),
    materialEn: String(row.material_en ?? ""),
    styleTags: String(row.style_tags ?? ""),
    styleTagsEn: String(row.style_tags_en ?? ""),
    textureUrl: (row.texture_url as string | null) ?? null,
    curtainImageUrl: (row.curtain_image_url as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listFabrics(limit = 4000, offset = 0) {
  const db = getDb();
  const result = await db.query(
    `
      select
        id,
        name,
        name_en,
        description,
        description_en,
        color,
        color_en,
        material,
        material_en,
        style_tags,
        style_tags_en,
        texture_url,
        curtain_image_url,
        sort_order,
        created_at,
        updated_at
      from curtain_fabrics
      order by sort_order asc, created_at desc
      limit $1
      offset $2
    `,
    [limit, offset]
  );
  return result.rows.map(mapFabricRow);
}

export async function getFabricDbById(id: string) {
  const db = getDb();
  const result = await db.query(`select * from curtain_fabrics where id = $1 limit 1`, [id]);
  return result.rowCount === 0 ? null : mapFabricRow(result.rows[0]);
}

export async function upsertFabric(input: {
  id?: string;
  name: string;
  nameEn?: string;
  description?: string;
  color?: string;
  material?: string;
  styleTags?: string;
  textureUrl?: string | null;
  curtainImageUrl?: string | null;
  sortOrder?: number;
}) {
  const db = getDb();
  const id = input.id || randomUUID();
  const result = await db.query(
    `insert into curtain_fabrics (id, name, name_en, description, color, material, style_tags, texture_url, curtain_image_url, sort_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (id) do update set
       name = excluded.name,
       name_en = excluded.name_en,
       description = excluded.description,
       color = excluded.color,
       material = excluded.material,
       style_tags = excluded.style_tags,
       texture_url = excluded.texture_url,
       curtain_image_url = excluded.curtain_image_url,
       sort_order = excluded.sort_order,
       updated_at = now()
     returning *`,
    [id, input.name, input.nameEn ?? "", input.description ?? "", input.color ?? "", input.material ?? "", input.styleTags ?? "", input.textureUrl ?? null, input.curtainImageUrl ?? null, input.sortOrder ?? 0]
  );
  return mapFabricRow(result.rows[0]);
}

export async function deleteFabric(id: string) {
  const db = getDb();
  await db.query(`delete from curtain_fabrics where id = $1`, [id]);
}

// ==================== Knowledge Docs ====================

export type KnowledgeDoc = {
  id: string;
  title: string;
  category: string;
  tags: string;
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

function mapKnowledgeRow(row: Record<string, unknown>): KnowledgeDoc {
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category ?? "general"),
    tags: String(row.tags ?? ""),
    content: String(row.content),
    source: String(row.source ?? "Manual"),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listKnowledgeDocs(limit = 2000, offset = 0) {
  const db = getDb();
  const result = await db.query(
    `
      select id, title, category, tags, content, source, created_at, updated_at
      from curtain_knowledge_docs
      order by created_at desc
      limit $1
      offset $2
    `,
    [limit, offset]
  );
  return result.rows.map(mapKnowledgeRow);
}

export async function upsertKnowledgeDoc(input: {
  id?: string;
  title: string;
  category?: string;
  tags?: string;
  content: string;
  source?: string;
}) {
  const db = getDb();
  const id = input.id || randomUUID();
  const result = await db.query(
    `insert into curtain_knowledge_docs (id, title, category, tags, content, source)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       title = excluded.title,
       category = excluded.category,
       tags = excluded.tags,
       content = excluded.content,
       source = excluded.source,
       updated_at = now()
     returning *`,
    [id, input.title, input.category ?? "general", input.tags ?? "", input.content, input.source ?? "Manual"]
  );
  return mapKnowledgeRow(result.rows[0]);
}

export async function deleteKnowledgeDoc(id: string) {
  const db = getDb();
  await db.query(`delete from curtain_knowledge_docs where id = $1`, [id]);
}

// ==================== SKU helpers ====================


