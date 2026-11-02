export type LoginRole = "org_owner" | "org_admin" | "advisor";

export type LoginErrorCode =
  | "access_denied"
  | "admin_access"
  | "platform_access"
  | "oauth"
  | "unconfigured"
  | "server";

export type LoginErrorContent = {
  title: string;
  description: string;
  canOpenWorkspace: boolean;
};

export type EmailLoginFailure = {
  kind: "access_denied" | "delivery_unavailable" | "rate_limited" | "network" | "unknown";
  message: string;
};

const LOGIN_ERROR_CONTENT: Record<LoginErrorCode, LoginErrorContent> = {
  access_denied: {
    title: "你的账号没有权限",
    description: "你的账号未获得工作台访问权限，请联系机构管理员开通后再试。",
    canOpenWorkspace: false,
  },
  admin_access: {
    title: "没有机构管理权限",
    description: "登录成功，但此账号只能使用顾问工作台。如需管理机构，请联系机构所有者调整角色。",
    canOpenWorkspace: true,
  },
  platform_access: {
    title: "没有平台管理权限",
    description: "登录成功，但此账号不是平台管理员。你仍可进入已获授权的员工工作台。",
    canOpenWorkspace: true,
  },
  oauth: {
    title: "你的账号没有权限",
    description: "你的账号未获得工作台访问权限，请联系机构管理员开通后再试。",
    canOpenWorkspace: false,
  },
  unconfigured: {
    title: "登录服务尚未配置",
    description: "当前环境还没有完成登录服务配置，请联系平台管理员。",
    canOpenWorkspace: false,
  },
  server: {
    title: "暂时无法验证账号权限",
    description: "登录服务暂时不可用，请稍后重试。如果问题持续出现，请联系平台管理员。",
    canOpenWorkspace: false,
  },
};

export function getLoginErrorContent(code: string | null | undefined) {
  if (!code || !(code in LOGIN_ERROR_CONTENT)) return null;
  return LOGIN_ERROR_CONTENT[code as LoginErrorCode];
}

export function getEmailLoginFailure(error: unknown): EmailLoginFailure {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (normalized.includes("only invited staff") || normalized.includes("not invited")) {
    return {
      kind: "access_denied",
      message: "你的账号没有权限，请联系管理员确认邀请邮箱是否完全一致。",
    };
  }
  if (normalized.includes("email address not authorized") || normalized.includes("email_address_not_authorized")) {
    return {
      kind: "delivery_unavailable",
      message: "当前邮件服务无法向该邮箱发信，请使用 Google 登录或联系管理员。",
    };
  }
  if (normalized.includes("rate limit") || normalized.includes("only request this after")) {
    return {
      kind: "rate_limited",
      message: "发送过于频繁，请等待一分钟后再试。",
    };
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) {
    return {
      kind: "network",
      message: "登录服务连接失败，请检查网络后重试。",
    };
  }
  return {
    kind: "unknown",
    message: "登录链接发送失败，请稍后重试。",
  };
}

export function getRequestedAccessError(
  next: string,
  role: LoginRole,
  isPlatformAdmin: boolean,
): LoginErrorCode | null {
  if ((next === "/platform" || next.startsWith("/platform/")) && !isPlatformAdmin) {
    return "platform_access";
  }
  if (
    (next === "/admin" || next.startsWith("/admin/")) &&
    role !== "org_owner" &&
    role !== "org_admin"
  ) {
    return "admin_access";
  }
  return null;
}
