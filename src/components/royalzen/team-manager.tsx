"use client";

import { FormEvent, useState } from "react";
import Icon from "@/components/royalzen/icon";
import type { InvitableOrganizationRole } from "@/lib/organization-role";
import type { TeamMemberRecord, WorkspaceRole } from "@/lib/platform-db";

type Role = InvitableOrganizationRole;

const STATUS_LABELS = {
  active: "活跃",
  disabled: "已停用",
  invited: "等待接受",
} as const;

export default function TeamManager({
  currentUserId,
  currentUserRole,
  initialItems,
}: {
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  initialItems: TeamMemberRecord[];
}) {
  const [items, setItems] = useState(initialItems);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("advisor");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // 不用 Role：那个类型是「可邀请的角色」，不含 org_owner，而筛选要能筛所有者
  const [roleFilter, setRoleFilter] = useState<"" | "org_owner" | "org_admin" | "advisor">("");
  const [statusFilter, setStatusFilter] = useState<"active" | "invited" | "disabled" | "">("");
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();

  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "操作失败。");
    return payload;
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("invite");
    setMessage("");
    try {
      const payload = await request("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName: name, role }),
      });
      setItems((current) => [...current.filter((item) => item.email !== payload.item.email), payload.item]);
      setEmail("");
      setName("");
      setOpen(false);
      setMessage(payload.emailSent ? "邀请邮件已发送。" : "成员已加入邀请名单；配置服务端密钥后可自动发邮件。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "邀请失败。");
    } finally {
      setSaving(null);
    }
  };

  const updateMember = async (memberId: string, change: { role?: Role; status?: "active" | "disabled" }) => {
    setSaving(memberId);
    setMessage("");
    try {
      const payload = await request("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, ...change }),
      });
      setItems((current) => current.map((item) => item.id === memberId ? payload.item : item));
      setMessage("成员权限已更新，并将在下一次服务端请求生效。");
      setConfirmingId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改成员失败。");
    } finally {
      setSaving(null);
    }
  };

  const resendInvite = async (person: TeamMemberRecord) => {
    if (person.role === "org_owner") return;
    setSaving(person.id);
    setMessage("");
    try {
      const payload = await request("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: person.email, displayName: person.displayName, role: person.role }),
      });
      setItems((current) => current.map((item) => item.id === person.id ? payload.item : item));
      setMessage(payload.emailSent ? "邀请邮件已重新发送。" : "邀请已刷新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新邀请失败。");
    } finally {
      setSaving(null);
    }
  };

  const revokeInvite = async (memberId: string) => {
    setSaving(memberId);
    setMessage("");
    try {
      await request(`/api/team?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== memberId));
      setMessage("未接受的邀请已撤销。");
      setConfirmingId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤销邀请失败。");
    } finally {
      setSaving(null);
    }
  };

  const ownerCount = items.filter((item) => item.role === "org_owner" && item.status === "active").length;
  const adminCount = items.filter((item) => item.role === "org_admin" && item.status === "active").length;
  const advisorCount = items.filter((item) => item.role === "advisor" && item.status !== "disabled").length;

  // 一屋子人的时候，要找的往往是「谁还没接受邀请」和「哪几个顾问停用了」。
  // 角色摘要那三块本来就在数这些数，点一下就当筛选器用，不必再造一排按钮。
  const shown = items.filter((person) => {
    if (roleFilter && person.role !== roleFilter) return false;
    if (statusFilter && person.status !== statusFilter) return false;
    if (!keyword) return true;
    return `${person.displayName} ${person.email}`.toLowerCase().includes(keyword);
  });

  return <>
    <header className="rz-admin-heading">
      <div><span className="rz-eyebrow">TEAM & ACCESS</span><h1>团队与权限</h1><p>通过邀请加入机构；Google 只验证身份，所有者、管理员和顾问权限均由服务端决定。</p></div>
      <button className="rz-button rz-button-primary" onClick={() => setOpen((value) => !value)} type="button"><Icon name="plus" size={17} />邀请员工</button>
    </header>

    {open ? <form className="rz-team-invite" onSubmit={invite}>
      <label className="rz-field"><span>姓名</span><input onChange={(event) => setName(event.target.value)} placeholder="员工姓名" value={name} /></label>
      <label className="rz-field"><span>工作邮箱</span><input onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required type="email" value={email} /></label>
      <label className="rz-field"><span>角色</span><select onChange={(event) => setRole(event.target.value as Role)} value={role}><option value="advisor">顾问员工</option>{currentUserRole === "org_owner" ? <option value="org_admin">机构管理员</option> : null}</select></label>
      <button className="rz-button rz-button-primary" disabled={Boolean(saving)} type="submit">{saving === "invite" ? "正在邀请..." : "发送邀请"}</button>
    </form> : null}

    {message ? <p className="rz-admin-message" role="status">{message}</p> : null}

    <div className="rz-role-summary">
      <article className={roleFilter === "org_owner" ? "is-selected" : ""} onClick={() => setRoleFilter((current) => (current === "org_owner" ? "" : "org_owner"))}><Icon name="building" /><div><strong>机构所有者</strong><p>唯一最高机构角色，负责任命和管理管理员。</p></div><span>{String(ownerCount).padStart(2, "0")}</span></article>
      <article className={roleFilter === "org_admin" ? "is-selected" : ""} onClick={() => setRoleFilter((current) => (current === "org_admin" ? "" : "org_admin"))}><Icon name="admin" /><div><strong>机构管理员</strong><p>管理员工、商品、知识库和机构配置。</p></div><span>{String(adminCount).padStart(2, "0")}</span></article>
      <article className={roleFilter === "advisor" ? "is-selected" : ""} onClick={() => setRoleFilter((current) => (current === "advisor" ? "" : "advisor"))}><Icon name="consultation" /><div><strong>顾问员工</strong><p>创建咨询、推荐商品、生成和分享方案。</p></div><span>{String(advisorCount).padStart(2, "0")}</span></article>
    </div>

    <div className="rz-team-filters">
      <input aria-label="搜索成员" onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" value={query} />
      {([["", "全部状态"], ["active", "在职"], ["invited", "待接受"], ["disabled", "已停用"]] as const).map(([value, label]) => (
        <button className={statusFilter === value ? "is-selected" : ""} key={value || "all"} onClick={() => setStatusFilter(value)} type="button">
          {label}
          <i>{value ? items.filter((item) => item.status === value).length : items.length}</i>
        </button>
      ))}
      {roleFilter || statusFilter || keyword ? (
        <button className="rz-team-clear" onClick={() => { setRoleFilter(""); setStatusFilter(""); setQuery(""); }} type="button">清除筛选</button>
      ) : null}
    </div>

    <div className="rz-team-table">
      <div className="rz-team-table-head"><span>成员 {shown.length !== items.length ? `（${shown.length} / ${items.length}）` : ""}</span><span>角色</span><span>状态</span><span>操作</span></div>
      {shown.length === 0 ? <p className="rz-empty-state">没有匹配的成员。</p> : null}
      {shown.map((person) => {
        const isSelf = person.id === currentUserId;
        const isSaving = saving === person.id;
        const canManagePerson = !isSelf && person.role !== "org_owner" && (
          currentUserRole === "org_owner" || (currentUserRole === "org_admin" && person.role === "advisor")
        );
        const canChangeRole = canManagePerson && currentUserRole === "org_owner";
        return <div className="rz-team-row" key={person.email}>
          <span><i>{person.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</i><span><strong>{person.displayName}{isSelf ? "（你）" : ""}</strong><small>{person.email}</small></span></span>
          <span>
            <select aria-label={`${person.displayName}的角色`} disabled={!canChangeRole || isSaving || person.status === "disabled"} onChange={(event) => updateMember(person.id, { role: event.target.value as Role })} value={person.role}>
              {person.role === "org_owner" ? <option value="org_owner">机构所有者</option> : null}
              <option value="advisor">顾问员工</option>
              <option value="org_admin">机构管理员</option>
            </select>
          </span>
          <span><i className={person.status === "active" ? "is-active" : person.status === "disabled" ? "is-disabled" : ""} />{STATUS_LABELS[person.status]}</span>
          <span className="rz-team-actions">
            {person.status === "invited" && canManagePerson ? <>
              <button disabled={isSaving} onClick={() => resendInvite(person)} type="button">重新发送</button>
              {confirmingId === person.id
                ? <><button className="is-danger" disabled={isSaving} onClick={() => revokeInvite(person.id)} type="button">确认撤销</button><button disabled={isSaving} onClick={() => setConfirmingId(null)} type="button">取消</button></>
                : <button disabled={isSaving} onClick={() => setConfirmingId(person.id)} type="button">撤销</button>}
            </> : null}
            {canManagePerson && person.status === "active" && confirmingId !== person.id ? <button disabled={isSaving} onClick={() => setConfirmingId(person.id)} type="button">停用</button> : null}
            {canManagePerson && person.status === "disabled" ? <button disabled={isSaving} onClick={() => updateMember(person.id, { status: "active" })} type="button">恢复</button> : null}
            {canManagePerson && confirmingId === person.id && person.status === "active" ? <><button className="is-danger" disabled={isSaving} onClick={() => updateMember(person.id, { status: "disabled" })} type="button">确认停用</button><button disabled={isSaving} onClick={() => setConfirmingId(null)} type="button">取消</button></> : null}
          </span>
        </div>;
      })}
    </div>
  </>;
}
