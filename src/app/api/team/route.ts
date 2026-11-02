import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requireOrganizationAdminMfa } from "@/lib/auth";
import { inviteTeamMember, listTeam, revokeTeamInvitation, updateTeamMember, writeAuditLog } from "@/lib/platform-db";
import { assertTeamInviteAllowed, TeamPolicyError } from "@/lib/team-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireOrganizationAdminMfa();
    return NextResponse.json({ items: await listTeam(actor) });
  } catch (error) {
    return apiError(error, "读取团队成员失败。");
  }
}

const inviteSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().max(100).optional(),
  role: z.enum(["org_admin", "advisor"]).default("advisor")
});

const updateSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["org_admin", "advisor"]).optional(),
  status: z.enum(["active", "disabled"]).optional()
}).refine((value) => value.role || value.status, "至少需要修改一个字段。");

function teamPolicyError(error: unknown) {
  return error instanceof TeamPolicyError
    ? NextResponse.json({ error: error.message }, { status: error.status })
    : null;
}

export async function POST(request: Request) {
  try {
    const actor = await requireOrganizationAdminMfa();
    const input = inviteSchema.parse(await request.json());
    assertTeamInviteAllowed({ actorRole: actor.role, targetRole: input.role });
    const member = await inviteTeamMember(actor, input);
    let emailSent = false;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await supabase.auth.admin.inviteUserByEmail(input.email, {
        redirectTo: `${new URL(request.url).origin}/auth/callback?next=/app`
      });
      if (error && !error.message.toLowerCase().includes("already")) throw error;
      emailSent = !error;
    }
    await writeAuditLog(actor, "team.invited", "user", member.id, { email: input.email, role: input.role, emailSent });
    return NextResponse.json({ item: member, emailSent }, { status: 201 });
  } catch (error) {
    const policyResponse = teamPolicyError(error);
    if (policyResponse) return policyResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "邀请信息格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "邀请员工失败。");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireOrganizationAdminMfa();
    const item = await updateTeamMember(actor, updateSchema.parse(await request.json()));
    return NextResponse.json({ item });
  } catch (error) {
    const policyResponse = teamPolicyError(error);
    if (policyResponse) return policyResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "成员修改信息格式不正确。", issues: error.issues }, { status: 400 });
    }
    return apiError(error, "修改团队成员失败。");
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireOrganizationAdminMfa();
    const memberId = z.string().uuid().parse(new URL(request.url).searchParams.get("memberId"));
    await revokeTeamInvitation(actor, memberId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const policyResponse = teamPolicyError(error);
    if (policyResponse) return policyResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "邀请标识格式不正确。" }, { status: 400 });
    }
    return apiError(error, "撤销邀请失败。");
  }
}
