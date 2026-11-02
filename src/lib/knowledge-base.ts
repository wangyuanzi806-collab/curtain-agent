import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "@/lib/db";

export type KnowledgeDoc = {
  id: string;
  title: string;
  category: string;
  tags: string;
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  score?: number;
  excerpt?: string;
};

type AddKnowledgeInput = {
  title: string;
  category: string;
  tags: string;
  content: string;
  source?: string;
};

type SearchKnowledgeInput = {
  roomType?: string;
  style?: string;
  desiredColor?: string;
  opacityNeed?: string;
  extraInstruction?: string;
  limit?: number;
};

type ImportMode = "replace" | "upsert";

const KNOWLEDGE_SYNONYMS: Record<string, string[]> = {
  客厅: ["客厅", "living room", "lounge"],
  卧室: ["卧室", "bedroom", "sleep space"],
  餐厅: ["餐厅", "dining room"],
  书房: ["书房", "study", "home office"],
  儿童房: ["儿童房", "kids room", "nursery"],
  老人房: ["老人房", "senior room"],
  阳台: ["阳台", "balcony"],
  飘窗区: ["飘窗", "bay window"],
  现代简约: ["现代简约", "modern", "minimal", "clean lines"],
  奶油风: ["奶油风", "cream style", "soft neutral"],
  北欧: ["北欧", "scandinavian"],
  侘寂风: ["侘寂风", "wabi-sabi"],
  轻奢: ["轻奢", "light luxury", "refined"],
  法式: ["法式", "french"],
  美式: ["美式", "american classic"],
  中古风: ["中古风", "mid-century", "midcentury"],
  日式原木: ["日式原木", "japandi", "natural wood"],
  现代东方: ["现代东方", "modern oriental"],
  酒店感: ["酒店感", "hotel style"],
  海岸风: ["海岸风", "coastal"],
  米白: ["米白", "off-white", "ivory", "oatmeal"],
  暖白: ["暖白", "warm white", "soft white"],
  纯白: ["纯白", "pure white", "bright white"],
  奶油色: ["奶油色", "cream"],
  浅灰: ["浅灰", "light gray", "soft gray"],
  深灰: ["深灰", "dark gray", "charcoal"],
  米咖: ["米咖", "taupe", "greige"],
  卡其: ["卡其", "khaki"],
  驼色: ["驼色", "camel"],
  雾蓝: ["雾蓝", "dusty blue"],
  墨绿: ["墨绿", "dark green", "forest green"],
  豆沙粉: ["豆沙粉", "dusty pink", "blush"],
  room_darkening: ["遮光", "blackout", "room darkening"],
  light_filtering: ["纱帘", "轻透", "sheer", "light filtering"],
  medium: ["中等透光", "semi-sheer", "medium opacity"]
};

const SAMPLE_KNOWLEDGE_DOCS: Array<Omit<KnowledgeDoc, "id" | "createdAt" | "updatedAt">> = [
  {
    title: "客厅窗帘推荐原则",
    category: "living_room",
    tags: "客厅,living room,现代简约,奶油风,light filtering,room darkening",
    content:
      "客厅更适合在采光和柔和感之间取平衡。对于明亮的公共空间，米白、暖白、燕麦色、浅灰这类中性色通常是最稳妥的推荐。只有在西晒强、临街或客户明确强调隐私时，再优先推荐更强遮光的面料。",
    source: "示例知识库"
  },
  {
    title: "卧室遮光建议",
    category: "bedroom",
    tags: "卧室,bedroom,遮光,双层,睡眠",
    content:
      "卧室场景通常优先考虑遮光和私密性。若客户既想保留柔和氛围又要遮光，推荐双层方案：内层纱帘、外层遮光帘。颜色上依然以中性色最容易和床品、木色、墙面协调。",
    source: "示例知识库"
  },
  {
    title: "奶油风配色建议",
    category: "color_matching",
    tags: "奶油风,米白,暖白,奶油色,燕麦色,greige",
    content:
      "奶油风空间适合软中性色窗帘：米白、暖白、奶油色、燕麦色、米咖都很稳。除非房间本身已经有较冷的石材或金属，否则不建议优先推荐偏冷的蓝灰色窗帘。",
    source: "示例知识库"
  },
  {
    title: "深色窗框搭配",
    category: "window_style",
    tags: "深色窗框,dark frame,modern,light luxury",
    content:
      "如果空间里有黑框或深色金属窗框，窗帘更适合用浅色去软化对比。暖白、浅灰、浅米咖通常比高饱和颜色更安全。安装上建议做全高挂法，从窗框上方起挂，视觉上更显层高。",
    source: "示例知识库"
  },
  {
    title: "公共空间纱帘场景",
    category: "sheer",
    tags: "纱帘,sheer,客厅,餐厅,采光,通透",
    content:
      "纱帘更适合客厅、餐厅、会客区这类看重采光和轻盈感的空间。如果客户强调柔光、空气感、白天氛围柔和，纱帘是优先项；如果强调隐私或睡眠遮光，就不应只推荐单层纱帘。",
    source: "示例知识库"
  },
  {
    title: "双层窗帘推荐原则",
    category: "layering",
    tags: "双层,double layer,纱帘,遮光,卧室,客厅",
    content:
      "双层窗帘是最通用、最不容易出错的推荐方案之一。白天用纱帘保留柔光，晚上用外层布帘控制隐私和遮光。对于卧室、酒店感空间、品质住宅，这通常是优先推荐方案。",
    source: "示例知识库"
  },
  {
    title: "窗帘高度和质感",
    category: "installation",
    tags: "落地,全高,安装,轨道,高级感",
    content:
      "想让效果图显得更高级，通常建议用全高落地的挂法，起挂点尽量抬高到窗框上方。除非是厨房或功能小窗，否则短帘容易让整体质感显得廉价，也更难做出高端住宅效果。",
    source: "示例知识库"
  },
  {
    title: "跳色窗帘使用边界",
    category: "accent_color",
    tags: "颜色,color,pink,green,blue,accent",
    content:
      "粉色、绿色、蓝色等跳色窗帘更适合作为明确偏好下的推荐，不适合作为默认安全答案。若空间里没有相应软装呼应，优先还是推荐白、米、灰、米咖这类更稳定的颜色。",
    source: "示例知识库"
  }
];

function normalizeKnowledgeDoc(raw: Partial<KnowledgeDoc>): KnowledgeDoc {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || randomUUID()).trim(),
    title: String(raw.title || "").trim(),
    category: String(raw.category || "general").trim(),
    tags: String(raw.tags || "").trim(),
    content: String(raw.content || "").trim(),
    source: String(raw.source || "Manual").trim(),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now)
  };
}

function mapKnowledgeRow(row: Record<string, unknown>): KnowledgeDoc {
  return normalizeKnowledgeDoc({
    id: row.id as string,
    title: row.title as string,
    category: row.category as string,
    tags: row.tags as string,
    content: row.content as string,
    source: row.source as string,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined
  });
}

function isKnowledgeDoc(doc: KnowledgeDoc) {
  return Boolean(doc.title && doc.content);
}

function buildExcerpt(content: string, maxLength = 180) {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength).trim()}...`;
}

function expandTerms(values: Array<string | undefined>) {
  const terms = new Set<string>();

  values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .forEach((value) => {
      const lowerValue = value.toLowerCase();
      terms.add(lowerValue);
      const synonyms = KNOWLEDGE_SYNONYMS[value];
      if (synonyms) {
        synonyms.forEach((item) => terms.add(item.toLowerCase()));
      }
    });

  return Array.from(terms);
}

function scoreKnowledgeDoc(doc: KnowledgeDoc, terms: string[]) {
  const haystack = `${doc.title} ${doc.category} ${doc.tags} ${doc.content}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (!term) continue;
    if (doc.title.toLowerCase().includes(term)) score += 5;
    if (doc.tags.toLowerCase().includes(term)) score += 4;
    if (doc.category.toLowerCase().includes(term)) score += 3;
    if (doc.content.toLowerCase().includes(term)) score += 2;
    if (haystack.includes(term)) score += 1;
  }

  if (score === 0 && terms.length === 0) {
    score = 1;
  }

  return score;
}

export function parseKnowledgeImportText(rawText: string, fileName = "") {
  const trimmed = rawText.trim();
  if (!trimmed) return [] as KnowledgeDoc[];

  const looksLikeJson = fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("[");
  if (looksLikeJson) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("知识库 JSON 需要是数组格式。");
    }

    return parsed.map((item) => normalizeKnowledgeDoc(item)).filter(isKnowledgeDoc);
  }

  return [
    normalizeKnowledgeDoc({
      title: fileName.replace(/\.[^.]+$/, "") || "Imported Knowledge",
      category: "general",
      tags: "",
      content: trimmed,
      source: "Imported File"
    })
  ];
}

export async function ensureKnowledgeSchema() {
  await ensureSchema();
  const db = getDb();
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
}

export async function listKnowledgeDocs(limit = 100) {
  await ensureKnowledgeSchema();
  const db = getDb();
  const result = await db.query(
    `select * from curtain_knowledge_docs order by updated_at desc limit $1`,
    [limit]
  );
  return result.rows.map((row) => mapKnowledgeRow(row as Record<string, unknown>));
}

export async function hasKnowledgeDocs() {
  await ensureKnowledgeSchema();
  const db = getDb();
  const result = await db.query(`select count(*)::int as count from curtain_knowledge_docs`);
  return Number(result.rows[0]?.count || 0) > 0;
}

export async function addKnowledgeDoc(input: AddKnowledgeInput) {
  await ensureKnowledgeSchema();
  const db = getDb();
  const doc = normalizeKnowledgeDoc({
    ...input,
    source: input.source || "Manual"
  });

  const result = await db.query(
    `
      insert into curtain_knowledge_docs (
        id, title, category, tags, content, source
      )
      values ($1, $2, $3, $4, $5, $6)
      returning *
    `,
    [doc.id, doc.title, doc.category, doc.tags, doc.content, doc.source]
  );

  return mapKnowledgeRow(result.rows[0] as Record<string, unknown>);
}

export async function importKnowledgeDocs(docs: KnowledgeDoc[], mode: ImportMode) {
  await ensureKnowledgeSchema();
  const db = getDb();
  const normalizedDocs = docs.map((doc) => normalizeKnowledgeDoc(doc)).filter(isKnowledgeDoc);
  if (normalizedDocs.length === 0) {
    return { imported: 0 };
  }

  const client = await db.connect();
  try {
    await client.query("begin");

    if (mode === "replace") {
      await client.query(`truncate table curtain_knowledge_docs`);
    }

    for (const doc of normalizedDocs) {
      await client.query(
        `
          insert into curtain_knowledge_docs (
            id, title, category, tags, content, source, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict (id) do update set
            title = excluded.title,
            category = excluded.category,
            tags = excluded.tags,
            content = excluded.content,
            source = excluded.source,
            updated_at = now()
        `,
        [doc.id, doc.title, doc.category, doc.tags, doc.content, doc.source]
      );
    }

    await client.query("commit");
    return { imported: normalizedDocs.length };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function importSampleKnowledgeDocs(mode: ImportMode = "replace") {
  const docs = SAMPLE_KNOWLEDGE_DOCS.map((item, index) =>
    normalizeKnowledgeDoc({
      id: `sample-kb-${index + 1}`,
      ...item
    })
  );

  return importKnowledgeDocs(docs, mode);
}

export async function searchKnowledgeDocs(input: SearchKnowledgeInput) {
  const docs = await listKnowledgeDocs(500);
  if (docs.length === 0) return [] as KnowledgeDoc[];

  const terms = expandTerms([
    input.roomType,
    input.style,
    input.desiredColor,
    input.opacityNeed,
    input.extraInstruction
  ]);

  return docs
    .map((doc) => ({
      ...doc,
      score: scoreKnowledgeDoc(doc, terms),
      excerpt: buildExcerpt(doc.content)
    }))
    .filter((doc) => doc.score && doc.score > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, Math.max(1, Math.min(10, input.limit ?? 3)));
}
