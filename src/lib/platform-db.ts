import { randomBytes, randomUUID } from "node:crypto";
import type { AuthAssuranceLevel } from "@/lib/auth-policy";
import { ensureSchema, getDb, shouldRunRuntimeSchemaSetup } from "@/lib/db";
import { normalizeStoredDisplayText } from "@/lib/display-text";
import type { InvitableOrganizationRole, OrganizationRole } from "@/lib/organization-role";
import { assertInviteRevocationAllowed, assertTeamInviteAllowed, assertTeamMutationAllowed, TeamPolicyError } from "@/lib/team-policy";

export type WorkspaceRole = OrganizationRole;

export type WorkspaceActor = {
  userId: string;
  authUserId: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  authAssuranceLevel: AuthAssuranceLevel;
  isDemo: boolean;
};

export type TeamMemberRecord = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  status: "active" | "disabled" | "invited";
  identityBound: boolean;
  createdAt: string;
};

export type ConsultationStatus =
  | "draft"
  | "analyzing"
  | "recommended"
  | "generating"
  | "ready"
  | "shared"
  | "archived"
  | "failed";

export type ConsultationRecord = {
  id: string;
  displayCode: string;
  organizationId: string;
  advisorUserId: string | null;
  advisorName: string;
  clientName: string;
  clientEmail: string;
  roomType: string;
  status: ConsultationStatus;
  sceneR2Key: string | null;
  sceneImageUrl: string | null;
  sceneAnalysis: Record<string, unknown>;
  preferences: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  selectedSkuId: string | null;
  selectedSkuSnapshot: Record<string, unknown>;
  generationId: string | null;
  resultImageUrl: string | null;
  resultR2Key: string | null;
  qualityTier: string;
  customerFeedback: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type CreateConsultationInput = {
  clientName?: string;
  clientEmail?: string;
  roomType?: string;
  preferences?: Record<string, unknown>;
};

type UpdateConsultationInput = Partial<{
  clientName: string;
  clientEmail: string;
  roomType: string;
  status: ConsultationStatus;
  sceneR2Key: string | null;
  sceneImageUrl: string | null;
  sceneAnalysis: Record<string, unknown>;
  preferences: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  selectedSkuId: string | null;
  selectedSkuSnapshot: Record<string, unknown>;
  generationId: string | null;
  resultImageUrl: string | null;
  resultR2Key: string | null;
  qualityTier: string;
  customerFeedback: Record<string, unknown>;
}>;

const DEMO_ORGANIZATION_ID = "org-royalzen";
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
let platformSchemaPromise: Promise<void> | null = null;
let demoActorPromise: Promise<WorkspaceActor> | null = null;

const DEMO_ACTOR: WorkspaceActor = {
  userId: DEMO_USER_ID,
  authUserId: null,
  organizationId: DEMO_ORGANIZATION_ID,
  organizationName: "RoyalZen",
  organizationSlug: "royalzen",
  email: "demo@royalzen.com",
  displayName: "Demo Advisor",
  avatarUrl: null,
  role: "org_owner",
  authAssuranceLevel: "aal2",
  isDemo: true
};

function toIso(value: unknown) {
  return new Date(String(value)).toISOString();
}

function toObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapConsultation(row: Record<string, unknown>): ConsultationRecord {
  return {
    id: String(row.id),
    displayCode: String(row.display_code),
    organizationId: String(row.organization_id),
    advisorUserId: row.advisor_user_id ? String(row.advisor_user_id) : null,
    advisorName: normalizeStoredDisplayText(row.advisor_name, "RoyalZen Advisor"),
    clientName: normalizeStoredDisplayText(row.client_name, "未命名客户"),
    clientEmail: String(row.client_email || ""),
    roomType: normalizeStoredDisplayText(row.room_type, "待分析"),
    status: String(row.status || "draft") as ConsultationStatus,
    sceneR2Key: row.scene_r2_key ? String(row.scene_r2_key) : null,
    sceneImageUrl: row.scene_image_url ? String(row.scene_image_url) : null,
    sceneAnalysis: toObject(row.scene_analysis),
    preferences: toObject(row.preferences),
    recommendation: toObject(row.recommendation),
    selectedSkuId: row.selected_sku_id ? String(row.selected_sku_id) : null,
    selectedSkuSnapshot: toObject(row.selected_sku_snapshot),
    generationId: row.generation_id ? String(row.generation_id) : null,
    resultImageUrl: row.result_image_url ? String(row.result_image_url) : null,
    resultR2Key: row.result_r2_key ? String(row.result_r2_key) : null,
    qualityTier: String(row.quality_tier || "balanced"),
    customerFeedback: toObject(row.customer_feedback),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function createDisplayCode() {
  const date = new Date();
  const y = String(date.getUTCFullYear()).slice(-2);
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `RZ-${y}${m}${d}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export async function ensurePlatformSchema() {
  if (!shouldRunRuntimeSchemaSetup()) return;
  if (!platformSchemaPromise) {
    platformSchemaPromise = (async () => {
      await ensureSchema();
      const db = getDb();

      await db.query(`
        create table if not exists organizations (
          id text primary key,
          slug text not null unique,
          name text not null,
          contact_email text not null default '',
          settings jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists app_users (
          id uuid primary key,
          auth_user_id uuid unique,
          email text not null unique,
          display_name text not null,
          avatar_url text,
          locale text not null default 'zh-CN',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists organization_members (
          organization_id text not null references organizations(id) on delete cascade,
          user_id uuid not null references app_users(id) on delete cascade,
          role text not null check (role in ('org_owner', 'org_admin', 'advisor')),
          status text not null default 'active' check (status in ('active', 'disabled')),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (organization_id, user_id)
        );

        create table if not exists organization_invites (
          id uuid primary key,
          organization_id text not null references organizations(id) on delete cascade,
          email text not null,
          role text not null check (role in ('org_admin', 'advisor')),
          invited_by uuid references app_users(id) on delete set null,
          token_hash text not null unique,
          expires_at timestamptz not null,
          accepted_at timestamptz,
          created_at timestamptz not null default now(),
          unique (organization_id, email)
        );

        create table if not exists consultations (
          id uuid primary key,
          display_code text not null unique,
          organization_id text not null references organizations(id) on delete cascade,
          advisor_user_id uuid references app_users(id) on delete set null,
          client_name text not null default '未命名客户',
          client_email text not null default '',
          room_type text not null default '',
          status text not null default 'draft',
          scene_r2_key text,
          scene_image_url text,
          scene_analysis jsonb not null default '{}'::jsonb,
          preferences jsonb not null default '{}'::jsonb,
          recommendation jsonb not null default '{}'::jsonb,
          selected_sku_id text,
          selected_sku_snapshot jsonb not null default '{}'::jsonb,
          generation_id text references curtain_generations(id) on delete set null,
          result_image_url text,
          result_r2_key text,
          quality_tier text not null default 'balanced',
          customer_feedback jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create index if not exists consultations_org_updated_idx
          on consultations (organization_id, updated_at desc);
        create index if not exists consultations_advisor_updated_idx
          on consultations (advisor_user_id, updated_at desc);

        create table if not exists consultation_shares (
          token text primary key,
          consultation_id uuid not null references consultations(id) on delete cascade,
          created_by uuid references app_users(id) on delete set null,
          expires_at timestamptz,
          revoked_at timestamptz,
          created_at timestamptz not null default now()
        );

        create table if not exists audit_logs (
          id uuid primary key,
          organization_id text references organizations(id) on delete set null,
          actor_user_id uuid references app_users(id) on delete set null,
          action text not null,
          entity_type text not null,
          entity_id text,
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );

        create index if not exists audit_logs_actor_user_id_idx on audit_logs (actor_user_id);
        create index if not exists audit_logs_organization_id_idx on audit_logs (organization_id);
        create index if not exists consultation_shares_consultation_id_idx on consultation_shares (consultation_id);
        create index if not exists consultation_shares_created_by_idx on consultation_shares (created_by);
        create index if not exists consultations_generation_id_idx on consultations (generation_id);
        create index if not exists organization_invites_invited_by_idx on organization_invites (invited_by);
        create index if not exists organization_members_user_id_idx on organization_members (user_id);

        alter table organizations enable row level security;
        alter table app_users enable row level security;
        alter table organization_members enable row level security;
        alter table organization_invites enable row level security;
        alter table consultations enable row level security;
        alter table consultation_shares enable row level security;
        alter table audit_logs enable row level security;
      `);

      await db.query(
        `insert into organizations (id, slug, name, contact_email)
         values ($1, 'royalzen', 'RoyalZen', 'advisor@royalzen.com')
         on conflict (id) do update set name = excluded.name, updated_at = now()`,
        [DEMO_ORGANIZATION_ID]
      );
    })().catch((error) => {
      platformSchemaPromise = null;
      throw error;
    });
  }

  await platformSchemaPromise;
}

export async function ensureDemoActor(): Promise<WorkspaceActor> {
  // A migrated database already contains this seed. Avoid two remote writes on
  // every cold start when runtime schema management is deliberately disabled.
  if (!shouldRunRuntimeSchemaSetup()) return DEMO_ACTOR;

  if (!demoActorPromise) {
    demoActorPromise = (async () => {
      await ensurePlatformSchema();
      const db = getDb();
      await db.query(
        `insert into app_users (id, email, display_name)
         values ($1, 'demo@royalzen.com', 'Demo Advisor')
         on conflict (id) do update set display_name = excluded.display_name, updated_at = now()`,
        [DEMO_USER_ID]
      );
      await db.query(
         `insert into organization_members (organization_id, user_id, role)
         values ($1, $2, 'org_admin')
         on conflict (organization_id, user_id)
         do update set role = excluded.role, status = 'active', updated_at = now()`,
        [DEMO_ORGANIZATION_ID, DEMO_USER_ID]
      );
      return DEMO_ACTOR;
    })().catch((error) => {
      demoActorPromise = null;
      throw error;
    });
  }

  return demoActorPromise;
}

export async function resolveActorFromAuth(input: {
  authUserId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  authAssuranceLevel: AuthAssuranceLevel;
}): Promise<WorkspaceActor | null> {
  await ensurePlatformSchema();
  const avatarUrl = input.avatarUrl || null;
  const toActor = (row: Record<string, unknown>): WorkspaceActor => ({
    userId: String(row.user_id),
    authUserId: input.authUserId,
    organizationId: String(row.organization_id),
    organizationName: String(row.organization_name),
    organizationSlug: String(row.organization_slug),
    email: input.email,
    displayName: input.displayName,
    avatarUrl,
    role: String(row.role) as WorkspaceRole,
    authAssuranceLevel: input.authAssuranceLevel,
    isDemo: false
  });

  const boundMembership = await getDb().query(
    `select
       u.id as user_id,
       u.auth_user_id,
       u.display_name,
       u.avatar_url,
       m.role,
       o.id as organization_id,
       o.name as organization_name,
       o.slug as organization_slug
     from app_users u
     join organization_members m on m.user_id = u.id and m.status = 'active'
     join organizations o on o.id = m.organization_id
     where u.auth_user_id = $1
     order by m.created_at asc
     limit 1`,
    [input.authUserId]
  );

  if (boundMembership.rowCount) {
    const row = boundMembership.rows[0];
    if (
      String(row.display_name || "") !== input.displayName ||
      (row.avatar_url ? String(row.avatar_url) : null) !== avatarUrl
    ) {
      await getDb().query(
        `update app_users
         set display_name = $2, avatar_url = $3, updated_at = now()
         where id = $1 and auth_user_id = $4`,
        [row.user_id, input.displayName, avatarUrl, input.authUserId]
      );
    }
    return toActor(row);
  }

  const client = await getDb().connect();
  try {
    await client.query("begin");
    const membership = await client.query(
      `select
         u.id as user_id,
         u.auth_user_id,
         u.display_name,
         u.avatar_url,
         m.role,
         o.id as organization_id,
         o.name as organization_name,
         o.slug as organization_slug
       from app_users u
       join organization_members m on m.user_id = u.id and m.status = 'active'
       join organizations o on o.id = m.organization_id
       where u.auth_user_id is null
         and lower(u.email) = lower($1)
         and exists (
           select 1
           from organization_invites invitation
           where invitation.organization_id = m.organization_id
             and lower(invitation.email) = lower($1)
             and invitation.accepted_at is null
             and invitation.expires_at > now()
         )
       order by m.created_at asc
       limit 1
       for update of u, m`,
      [input.email]
    );

    if (!membership.rowCount) {
      await client.query("rollback");
      return null;
    }
    const row = membership.rows[0];
    await client.query(
      `update app_users
       set auth_user_id = $2, display_name = $3, avatar_url = $4, updated_at = now()
       where id = $1 and auth_user_id is null`,
      [row.user_id, input.authUserId, input.displayName, avatarUrl]
    );
    await client.query(
      `update organization_invites
       set accepted_at = now()
       where organization_id = $1
         and lower(email) = lower($2)
         and accepted_at is null
         and expires_at > now()`,
      [row.organization_id, input.email]
    );
    await client.query("commit");
    return toActor(row);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createConsultation(actor: WorkspaceActor, input: CreateConsultationInput = {}) {
  await ensurePlatformSchema();
  const result = await getDb().query(
    `insert into consultations (
       id, display_code, organization_id, advisor_user_id,
       client_name, client_email, room_type, preferences
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     returning *, $9::text as advisor_name`,
    [
      randomUUID(),
      createDisplayCode(),
      actor.organizationId,
      actor.userId,
      input.clientName?.trim() || "未命名客户",
      input.clientEmail?.trim() || "",
      input.roomType?.trim() || "",
      JSON.stringify(input.preferences || {}),
      actor.displayName
    ]
  );
  return mapConsultation(result.rows[0]);
}

export async function listConsultations(actor: WorkspaceActor, limit = 20) {
  await ensurePlatformSchema();
  const result = await getDb().query(
    `select c.*, coalesce(u.display_name, 'RoyalZen Advisor') as advisor_name
     from consultations c
     left join app_users u on u.id = c.advisor_user_id
     where c.organization_id = $1
     order by c.updated_at desc
     limit $2`,
    [actor.organizationId, Math.max(1, Math.min(100, limit))]
  );
  return result.rows.map(mapConsultation);
}

export async function getConsultation(actor: WorkspaceActor, idOrCode: string) {
  await ensurePlatformSchema();
  const result = await getDb().query(
    `select c.*, coalesce(u.display_name, 'RoyalZen Advisor') as advisor_name
     from consultations c
     left join app_users u on u.id = c.advisor_user_id
     where c.organization_id = $1 and (c.id::text = $2 or c.display_code = $2)
     limit 1`,
    [actor.organizationId, idOrCode]
  );
  return result.rowCount ? mapConsultation(result.rows[0]) : null;
}

export async function updateConsultation(
  actor: WorkspaceActor,
  idOrCode: string,
  input: UpdateConsultationInput
) {
  const current = await getConsultation(actor, idOrCode);
  if (!current) return null;

  const merged = {
    clientName: input.clientName ?? current.clientName,
    clientEmail: input.clientEmail ?? current.clientEmail,
    roomType: input.roomType ?? current.roomType,
    status: input.status ?? current.status,
    sceneR2Key: input.sceneR2Key === undefined ? current.sceneR2Key : input.sceneR2Key,
    sceneImageUrl: input.sceneImageUrl === undefined ? current.sceneImageUrl : input.sceneImageUrl,
    sceneAnalysis: input.sceneAnalysis ?? current.sceneAnalysis,
    preferences: input.preferences ?? current.preferences,
    recommendation: input.recommendation ?? current.recommendation,
    selectedSkuId: input.selectedSkuId === undefined ? current.selectedSkuId : input.selectedSkuId,
    selectedSkuSnapshot: input.selectedSkuSnapshot ?? current.selectedSkuSnapshot,
    generationId: input.generationId === undefined ? current.generationId : input.generationId,
    resultImageUrl: input.resultImageUrl === undefined ? current.resultImageUrl : input.resultImageUrl,
    resultR2Key: input.resultR2Key === undefined ? current.resultR2Key : input.resultR2Key,
    qualityTier: input.qualityTier ?? current.qualityTier,
    customerFeedback: input.customerFeedback ?? current.customerFeedback
  };

  const result = await getDb().query(
    `update consultations set
       client_name = $3,
       client_email = $4,
       room_type = $5,
       status = $6,
       scene_r2_key = $7,
       scene_image_url = $8,
       scene_analysis = $9::jsonb,
       preferences = $10::jsonb,
       recommendation = $11::jsonb,
       selected_sku_id = $12,
       selected_sku_snapshot = $13::jsonb,
       generation_id = $14,
       result_image_url = $15,
       result_r2_key = $16,
       quality_tier = $17,
       customer_feedback = $18::jsonb,
       updated_at = now()
     where organization_id = $1 and id = $2::uuid
     returning *, $19::text as advisor_name`,
    [
      actor.organizationId,
      current.id,
      merged.clientName,
      merged.clientEmail,
      merged.roomType,
      merged.status,
      merged.sceneR2Key,
      merged.sceneImageUrl,
      JSON.stringify(merged.sceneAnalysis),
      JSON.stringify(merged.preferences),
      JSON.stringify(merged.recommendation),
      merged.selectedSkuId,
      JSON.stringify(merged.selectedSkuSnapshot),
      merged.generationId,
      merged.resultImageUrl,
      merged.resultR2Key,
      merged.qualityTier,
      JSON.stringify(merged.customerFeedback),
      actor.displayName
    ]
  );
  return mapConsultation(result.rows[0]);
}

export async function deleteConsultation(actor: WorkspaceActor, idOrCode: string) {
  const current = await getConsultation(actor, idOrCode);
  if (!current) return false;
  const db = getDb();
  // 资产与生成记录的外键是 on delete set null，只删咨询会把它们留成孤儿：
  // 界面上再也看不到，库里却一直堆着。要删就删干净。
  //
  // 顺序不能动。有两张表指向 private_assets 且规则是 **on delete restrict**——
  // 只要这条咨询生成过分享链接或推荐方案，先删资产就会被数据库直接拒绝，
  // 而界面上只显示「没删成」，看不出被什么挡住。所以先把这两张清掉。
  //
  // 这两条是一个个撞出来的：先撞 consultation_shares，修完又撞 recommendation_plans。
  // 别再靠撞——要加表时先查 information_schema 看谁引用了 private_assets：
  //   select tc.table_name, rc.delete_rule from information_schema.table_constraints tc
  //     join information_schema.constraint_column_usage ccu using (constraint_name)
  //     join information_schema.referential_constraints rc using (constraint_name)
  //    where tc.constraint_type='FOREIGN KEY' and ccu.table_name='private_assets';
  await db.query(`delete from consultation_shares where consultation_id = $1::uuid`, [current.id]);
  // recommendation_plans 只有旧库有：迁库时判断「代码零引用」跳过了它，新库根本没这张表。
  // 而本地开发连旧库、线上连新库——所以这句在本地跑得好好的，一上线就 42P01
  // 把所有删除全挡了。表不存在就跳过，别的错照抛。
  await db
    .query(`delete from recommendation_plans where consultation_id = $1::uuid`, [current.id])
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code !== "42P01") throw error;
    });
  // 再解掉咨询指回资产的那三个引用，否则删资产会被咨询自己这张表挡住
  await db.query(
    `update consultations
        set current_scene_asset_id = null, scene_analysis_asset_id = null, generation_id = null
      where organization_id = $1 and id = $2::uuid`,
    [actor.organizationId, current.id]
  );
  await db.query(
    `delete from private_assets where consultation_id = $1::uuid and organization_id = $2`,
    [current.id, actor.organizationId]
  );
  await db.query(`delete from curtain_generations where consultation_id = $1::uuid`, [current.id]);
  await db.query(
    `delete from consultations where organization_id = $1 and id = $2::uuid`,
    [actor.organizationId, current.id]
  );
  return true;
}

export async function createShare(actor: WorkspaceActor, idOrCode: string) {
  const consultation = await getConsultation(actor, idOrCode);
  if (!consultation) return null;
  const token = randomBytes(24).toString("base64url");
  await getDb().query(
    `insert into consultation_shares (token, consultation_id, created_by, expires_at)
     values ($1, $2::uuid, $3::uuid, now() + interval '30 days')`,
    [token, consultation.id, actor.userId]
  );
  await updateConsultation(actor, consultation.id, { status: "shared" });
  return { token, consultationId: consultation.id };
}

export async function getSharedConsultation(token: string) {
  await ensurePlatformSchema();
  const result = await getDb().query(
    `select c.*, coalesce(u.display_name, 'RoyalZen Advisor') as advisor_name
     from consultation_shares s
     join consultations c on c.id = s.consultation_id
     left join app_users u on u.id = c.advisor_user_id
     where s.token = $1
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now())
     limit 1`,
    [token]
  );
  return result.rowCount ? mapConsultation(result.rows[0]) : null;
}

export async function getDashboard(actor: WorkspaceActor) {
  await ensurePlatformSchema();
  const db = getDb();
  const [counts, recent] = await Promise.all([
    db.query(
      `select
         count(*) filter (where created_at >= date_trunc('week', now()))::int as weekly,
         count(*) filter (where status in ('ready', 'shared'))::int as completed,
         count(*) filter (where status = 'shared')::int as awaiting_feedback
       from consultations where organization_id = $1`,
      [actor.organizationId]
    ),
    listConsultations(actor, 8)
  ]);
  return {
    metrics: {
      weekly: Number(counts.rows[0]?.weekly || 0),
      completed: Number(counts.rows[0]?.completed || 0),
      awaitingFeedback: Number(counts.rows[0]?.awaiting_feedback || 0)
    },
    recent
  };
}

export async function listTeam(actor: WorkspaceActor) {
  await ensurePlatformSchema();
  const result = await getDb().query(
    `select u.id, u.auth_user_id, u.email, u.display_name, u.avatar_url, m.role, m.status, m.created_at
     from organization_members m
     join app_users u on u.id = m.user_id
     where m.organization_id = $1
     order by m.created_at asc`,
    [actor.organizationId]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    role: actor.isDemo && String(row.id) === DEMO_USER_ID
      ? "org_owner"
      : String(row.role) as WorkspaceRole,
    status: String(row.status) === "disabled"
      ? "disabled"
      : row.auth_user_id || String(row.id) === DEMO_USER_ID
        ? "active"
        : "invited",
    identityBound: Boolean(row.auth_user_id),
    createdAt: toIso(row.created_at)
  })) as TeamMemberRecord[];
}

export async function inviteTeamMember(
  actor: WorkspaceActor,
  input: { email: string; displayName?: string; role: InvitableOrganizationRole }
) {
  await ensurePlatformSchema();
  assertTeamInviteAllowed({ actorRole: actor.role, targetRole: input.role });
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const userResult = await db.query(
    `insert into app_users (id, email, display_name)
     values ($1::uuid, $2, $3)
     on conflict (email) do update set
       display_name = case when app_users.display_name = '' then excluded.display_name else app_users.display_name end,
       updated_at = now()
     returning id, auth_user_id, email, display_name`,
    [randomUUID(), email, input.displayName?.trim() || email.split("@")[0]]
  );
  const user = userResult.rows[0];
  await db.query(
    `insert into organization_members (organization_id, user_id, role, status)
     values ($1, $2::uuid, $3, 'active')
     on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active', updated_at = now()`,
    [actor.organizationId, user.id, input.role]
  );
  await db.query(
    `insert into organization_invites (id, organization_id, email, role, invited_by, token_hash, expires_at)
     values ($1::uuid, $2, $3, $4, $5::uuid, $6, now() + interval '7 days')
     on conflict (organization_id, email) do update set
       role = excluded.role,
       invited_by = excluded.invited_by,
       token_hash = excluded.token_hash,
       expires_at = excluded.expires_at,
       accepted_at = null,
       created_at = now()`,
    [randomUUID(), actor.organizationId, email, input.role, actor.userId, randomBytes(32).toString("hex")]
  );
  return {
    id: String(user.id),
    email,
    displayName: String(user.display_name),
    role: input.role,
    status: user.auth_user_id ? "active" : "invited",
    identityBound: Boolean(user.auth_user_id),
    avatarUrl: null,
    createdAt: new Date().toISOString()
  };
}

export async function updateTeamMember(
  actor: WorkspaceActor,
  input: { memberId: string; role?: WorkspaceRole; status?: "active" | "disabled" }
) {
  await ensurePlatformSchema();
  const client = await getDb().connect();
  try {
    await client.query("begin");
    const targetResult = await client.query(
      `select u.id, u.auth_user_id, u.email, u.display_name, u.avatar_url,
              m.role, m.status, m.created_at
       from organization_members m
       join app_users u on u.id = m.user_id
       where m.organization_id = $1 and u.id = $2::uuid
       for update`,
      [actor.organizationId, input.memberId]
    );
    if (!targetResult.rowCount) throw new TeamPolicyError("团队成员不存在。", 404);

    const adminResult = await client.query(
      `select member.user_id
       from organization_members as member
       join app_users as app_user on app_user.id = member.user_id
       where member.organization_id = $1
          and member.role in ('org_owner', 'org_admin')
         and member.status = 'active'
         and (app_user.auth_user_id is not null or app_user.id = $2::uuid)
       for update`,
      [actor.organizationId, DEMO_USER_ID]
    );
    const target = targetResult.rows[0];
    assertTeamMutationAllowed({
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetUserId: String(target.id),
      targetRole: String(target.role) as WorkspaceRole,
      targetStatus: String(target.status) as "active" | "disabled",
      targetIdentityBound: Boolean(target.auth_user_id),
      activePrivilegedCount: adminResult.rowCount || 0,
      nextRole: input.role,
      nextStatus: input.status
    });

    const nextRole = input.role || String(target.role) as WorkspaceRole;
    const nextStatus = input.status || String(target.status) as "active" | "disabled";
    await client.query(
      `update organization_members
       set role = $3, status = $4, updated_at = now()
       where organization_id = $1 and user_id = $2::uuid`,
      [actor.organizationId, input.memberId, nextRole, nextStatus]
    );
    await client.query(
      `insert into audit_logs (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, $3::uuid, 'team.member_updated', 'user', $4, $5::jsonb)`,
      [randomUUID(), actor.organizationId, actor.userId, input.memberId, JSON.stringify({
        previousRole: target.role,
        previousStatus: target.status,
        role: nextRole,
        status: nextStatus
      })]
    );
    await client.query("commit");
    return {
      id: String(target.id),
      email: String(target.email),
      displayName: String(target.display_name),
      avatarUrl: target.avatar_url ? String(target.avatar_url) : null,
      role: nextRole,
      status: nextStatus === "disabled" ? "disabled" : target.auth_user_id ? "active" : "invited",
      identityBound: Boolean(target.auth_user_id),
      createdAt: toIso(target.created_at)
    } as TeamMemberRecord;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeTeamInvitation(actor: WorkspaceActor, memberId: string) {
  await ensurePlatformSchema();
  const client = await getDb().connect();
  try {
    await client.query("begin");
    const targetResult = await client.query(
      `select u.id, u.auth_user_id, u.email
       from organization_members m
       join app_users u on u.id = m.user_id
       where m.organization_id = $1 and u.id = $2::uuid
       for update`,
      [actor.organizationId, memberId]
    );
    if (!targetResult.rowCount) throw new TeamPolicyError("邀请不存在。", 404);
    const target = targetResult.rows[0];
    assertInviteRevocationAllowed({
      actorUserId: actor.userId,
      targetUserId: String(target.id),
      targetIdentityBound: Boolean(target.auth_user_id)
    });

    await client.query(
      `delete from organization_invites where organization_id = $1 and lower(email) = lower($2)`,
      [actor.organizationId, target.email]
    );
    await client.query(
      `delete from organization_members where organization_id = $1 and user_id = $2::uuid`,
      [actor.organizationId, memberId]
    );
    await client.query(
      `insert into audit_logs (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, $3::uuid, 'team.invite_revoked', 'user', $4, $5::jsonb)`,
      [randomUUID(), actor.organizationId, actor.userId, memberId, JSON.stringify({ email: target.email })]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getAdminOverview(actor: WorkspaceActor) {
  await ensurePlatformSchema();
  const db = getDb();
  const result = await db.query(
    `select
       (select count(*)::int from organization_members where organization_id = $1 and status = 'active') as members,
       -- 读 sku_material 而不是 curtain_skus：后者一直是 0 条，
       -- 于是后台首页的「可推荐 SKU」长期显示 00，而库里真有 985 款。
       -- 口径与前台一致：上架 + 有白底图才算可推荐
       (select count(*)::int from sku_material m
          join sku_product_image i on i.factory_sku = m.factory_sku
         where m.status = 'active'
           and i.white_background_image_url is not null
           and btrim(i.white_background_image_url) <> '') as skus,
       (select count(*)::int from consultations where organization_id = $1 and created_at >= date_trunc('month', now())) as consultations,
       (select count(*)::int from curtain_generations where created_at >= date_trunc('month', now())) as generations,
       (select count(*)::int from curtain_generations where status = 'failed' and created_at >= now() - interval '24 hours') as failures,
       -- 面料就是商品：面料库这一页已经改读 sku_material，
       -- curtain_fabrics 那张 0 条的旧表不再是任何页面的数据源
       (select count(*)::int from sku_material where status = 'active') as fabrics`,
    [actor.organizationId]
  );
  // 知识条数单独查、单独兜错。
  // curtain_knowledge_docs 是 0 条的旧表，真内容在 curtain_kb_entries——
  // 但那张表是迁库时建的，**本地库与线上服务库结构并不完全一致**
  // （Codex 08-03 实测：线上 sku_product_image 连 updated_at 都没有）。
  // 表不存在就当 0，绝不能让机构概览整页 500：这一页是管理员进后台看到的第一屏。
  let knowledgeDocs = 0;
  try {
    const kb = await db.query(`select count(*)::int as count from curtain_kb_entries`);
    knowledgeDocs = Number(kb.rows[0]?.count || 0);
  } catch (error) {
    if ((error as { code?: string })?.code !== "42P01") throw error;
    console.warn("[admin] curtain_kb_entries 不存在，知识条数按 0 计");
  }

  const row = result.rows[0];
  return {
    members: Number(row.members || 0),
    skus: Number(row.skus || 0),
    consultations: Number(row.consultations || 0),
    generations: Number(row.generations || 0),
    failures: Number(row.failures || 0),
    knowledgeDocs,
    fabrics: Number(row.fabrics || 0)
  };
}

export async function updateActorProfile(
  actor: WorkspaceActor,
  input: { displayName?: string; locale?: string }
) {
  await ensurePlatformSchema();
  const displayName = input.displayName?.trim() || actor.displayName;
  const locale = input.locale?.trim() || "zh-CN";
  await getDb().query(
    `update app_users set display_name = $2, locale = $3, updated_at = now() where id = $1::uuid`,
    [actor.userId, displayName, locale]
  );
  return { ...actor, displayName };
}

export async function writeAuditLog(
  actor: WorkspaceActor,
  action: string,
  entityType: string,
  entityId?: string,
  metadata: Record<string, unknown> = {}
) {
  await ensurePlatformSchema();
  await getDb().query(
    `insert into audit_logs (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
     values ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb)`,
    [randomUUID(), actor.organizationId, actor.userId, action, entityType, entityId || null, JSON.stringify(metadata)]
  );
}
