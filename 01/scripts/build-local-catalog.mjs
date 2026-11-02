/**
 * 从生产库导出一份只读的本地商品库（SQLite），用于探索与试验。
 *
 * 只导「产品事实」三块：商品 / 价格 / 知识库。
 * 不导用户、组织、支付、审计、咨询记录——那些含身份数据，也不是做产品探索需要的。
 * 也不导 voice_* 与 v3_*：那些是线下语音助手建在同一个库里的对象，不属于本产品。
 *
 * 用法：node scripts/build-local-catalog.mjs [输出路径]
 * 默认输出 .local/curtain-catalog.db
 */
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const OUT = resolve(process.argv[2] || ".local/curtain-catalog.db");

/** 要导的表。顺序即建表顺序，被引用的放前面 */
const TABLES = [
  { name: "sku_material", pk: "factory_sku", note: "商品主表。颜色与花纹字段由白底图 CV + 视觉模型算出" },
  { name: "sku_product_image", pk: "factory_sku", note: "商品图。白底成品图是唯一有数据的一类" },
  { name: "curtain_product_prices", pk: "price_id", note: "🚨 假数据：老板为语音助手造的测试价格，不是真实售价。只能用来验证代码跑不跑得通" },
  { name: "curtain_kb_entries", pk: "entry_id", note: "⚠️ 真实性未确认：非本产品建立，来源不明，当真用之前先抽查" },
  { name: "curtain_kb_chunks", pk: null, note: "知识分块，检索用" },
  { name: "curtain_kb_sources", pk: "source_id", note: "知识来源登记" },
  { name: "curtain_kb_claims", pk: null, note: "知识断言" },
  { name: "curtain_kb_evidence", pk: null, note: "断言的证据链" }
];

/** Postgres 类型 → SQLite 类型。SQLite 只有 5 种存储类，够用 */
function toSqliteType(pgType) {
  if (/^(integer|bigint|smallint)$/.test(pgType)) return "INTEGER";
  if (/^(numeric|real|double)/.test(pgType)) return "REAL";
  if (/^bool/.test(pgType)) return "INTEGER";
  return "TEXT"; // uuid / text / jsonb / 数组 / 时间戳统一按文本存
}

/** jsonb、数组、时间戳都转成字符串存，读出来自己解析 */
function toSqliteValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^POSTGRES_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("未找到 POSTGRES_URL");

const pg = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await pg.connect();

mkdirSync(dirname(OUT), { recursive: true });
if (existsSync(OUT)) rmSync(OUT);
const db = new DatabaseSync(OUT);
db.exec("pragma journal_mode = wal");

const summary = [];

for (const table of TABLES) {
  const { rows: cols } = await pg.query(
    `select column_name, data_type, is_nullable,
            col_description(($1)::regclass, ordinal_position) as comment
       from information_schema.columns
      where table_schema = 'public' and table_name = $2
      order by ordinal_position`,
    [`public.${table.name}`, table.name]
  );
  if (cols.length === 0) {
    console.warn(`跳过 ${table.name}：生产库里没有这张表`);
    continue;
  }

  const defs = cols.map((c) => {
    const type = toSqliteType(c.data_type);
    const pk = table.pk === c.column_name ? " primary key" : "";
    return `  "${c.column_name}" ${type}${pk}`;
  });
  db.exec(`create table "${table.name}" (\n${defs.join(",\n")}\n)`);

  const { rows } = await pg.query(`select * from public."${table.name}"`);
  if (rows.length > 0) {
    const names = cols.map((c) => c.column_name);
    const stmt = db.prepare(
      `insert into "${table.name}" (${names.map((n) => `"${n}"`).join(",")}) ` +
        `values (${names.map(() => "?").join(",")})`
    );
    db.exec("begin");
    for (const row of rows) stmt.run(...names.map((n) => toSqliteValue(row[n])));
    db.exec("commit");
  }

  summary.push({ table: table.name, rows: rows.length, cols: cols.length, note: table.note });
  console.log(`${table.name.padEnd(26)} ${String(rows.length).padStart(5)} 行 × ${cols.length} 列`);
}

// 常用索引：探索时几乎一定会按这几个字段筛
db.exec(`
  create index idx_sku_color on sku_material(color_family, value_level);
  create index idx_sku_pattern on sku_material(pattern_level);
  create index idx_sku_material_class on sku_material(material_class);
  create index idx_sku_status on sku_material(status);
  create index idx_price_sku on curtain_product_prices(sku_id);
  create index idx_img_sku on sku_product_image(factory_sku);
`);

// 一个把商品、图片、价格拼好的视图，省得每次自己 join
db.exec(`
  create view sku_full as
  select m.*,
         i.white_background_image_url as image_url,
         (select count(*) from curtain_product_prices p where p.sku_id = m.factory_sku) as price_rows,
         (select min(p.amount_minor) from curtain_product_prices p where p.sku_id = m.factory_sku) as price_min_minor,
         (select max(p.amount_minor) from curtain_product_prices p where p.sku_id = m.factory_sku) as price_max_minor
    from sku_material m
    left join sku_product_image i on i.factory_sku = m.factory_sku
`);

db.exec(`create table _meta (key TEXT primary key, value TEXT)`);
const meta = db.prepare("insert into _meta (key, value) values (?, ?)");
meta.run("exported_at", new Date().toISOString());
meta.run("source", "User-configured PostgreSQL public schema");
meta.run("readonly", "本文件是只读快照。改这里不会影响生产，生产改了这里也不会自动更新。");
meta.run(
  "data_warnings",
  [
    "curtain_product_prices 全部是测试假价格，不得用于任何产品判断或分析。",
    "curtain_kb_* 的内容真实性未经确认，来源不明。",
    "sku_material 是真实商品数据，可放心使用。"
  ].join(" ")
);
meta.run("tables", JSON.stringify(summary));

const check = db.prepare("select count(*) n from sku_full where image_url is not null").get();
console.log(`\n视图 sku_full：${check.n} 款带图`);
console.log(`输出 ${OUT}`);

db.close();
await pg.end();
