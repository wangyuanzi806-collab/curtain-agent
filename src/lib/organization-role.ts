export type OrganizationRole = "org_owner" | "org_admin" | "advisor";
export type InvitableOrganizationRole = Exclude<OrganizationRole, "org_owner">;

export function hasOrganizationAdminAccess(role: OrganizationRole) {
  return role === "org_owner" || role === "org_admin";
}

export function canAssignOrganizationRole(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole
) {
  if (targetRole === "org_owner") return false;
  if (targetRole === "org_admin") return actorRole === "org_owner";
  return hasOrganizationAdminAccess(actorRole);
}

/**
 * 删咨询只有机构所有者能做。
 *
 * 它删的不只是一条记录：客户房间照片、生成的效果图、分享链接、推荐方案一并消失，
 * 且不可恢复。顾问每天在这个列表里进出，管理员也不少，把这个能力放给他们，
 * 迟早有人在整理时手滑清掉别人正在跟的单子。
 */
export function canDeleteConsultation(role: OrganizationRole) {
  return role === "org_owner";
}

export function organizationRoleLabel(role: OrganizationRole) {
  if (role === "org_owner") return "机构所有者";
  if (role === "org_admin") return "机构管理员";
  return "窗帘顾问";
}
