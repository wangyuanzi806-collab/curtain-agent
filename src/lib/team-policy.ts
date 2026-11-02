import type { OrganizationRole } from "@/lib/organization-role";

export class TeamPolicyError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "TeamPolicyError";
    this.status = status;
  }
}

type TeamMutationPolicyInput = {
  actorUserId: string;
  actorRole: OrganizationRole;
  targetUserId: string;
  targetRole: OrganizationRole;
  targetStatus: "active" | "disabled";
  targetIdentityBound: boolean;
  activePrivilegedCount: number;
  nextRole?: OrganizationRole;
  nextStatus?: "active" | "disabled";
};

export function assertTeamInviteAllowed(input: {
  actorRole: OrganizationRole;
  targetRole: OrganizationRole;
}) {
  if (input.targetRole === "org_owner") {
    throw new TeamPolicyError("不能通过邀请分配机构所有者，请使用所有权转移流程。");
  }
  if (input.targetRole === "org_admin" && input.actorRole !== "org_owner") {
    throw new TeamPolicyError("只有机构所有者可以任命管理员。", 403);
  }
}

export function assertTeamMutationAllowed(input: TeamMutationPolicyInput) {
  const nextRole = input.nextRole ?? input.targetRole;
  const nextStatus = input.nextStatus ?? input.targetStatus;
  const changesRole = nextRole !== input.targetRole;
  const changesStatus = nextStatus !== input.targetStatus;

  if (input.actorUserId === input.targetUserId && changesRole && nextRole !== "org_admin") {
    throw new TeamPolicyError("不能降低自己的管理员权限，请由另一名管理员操作。");
  }
  if (input.actorUserId === input.targetUserId && changesStatus && nextStatus !== "active") {
    throw new TeamPolicyError("不能停用自己的账号，请由另一名管理员操作。");
  }

  const managesPrivilegedRole = input.targetRole !== "advisor" || nextRole !== "advisor";
  if (input.actorRole !== "org_owner" && managesPrivilegedRole && (changesRole || changesStatus)) {
    throw new TeamPolicyError("只有机构所有者可以管理管理员权限。", 403);
  }

  const removesActiveAdmin = input.targetRole !== "advisor" && input.targetStatus === "active"
    && (nextRole === "advisor" || nextStatus !== "active");
  if (removesActiveAdmin && input.activePrivilegedCount <= 1) {
    throw new TeamPolicyError("机构至少保留一名活跃管理员。");
  }
}

export function assertInviteRevocationAllowed(input: {
  actorUserId: string;
  targetUserId: string;
  targetIdentityBound: boolean;
}) {
  if (input.actorUserId === input.targetUserId || input.targetIdentityBound) {
    throw new TeamPolicyError("只能撤销尚未接受的邀请。");
  }
}
