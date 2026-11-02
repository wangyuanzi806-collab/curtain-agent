create index if not exists audit_logs_actor_user_id_idx
  on public.audit_logs (actor_user_id);

create index if not exists audit_logs_organization_id_idx
  on public.audit_logs (organization_id);

create index if not exists consultation_shares_consultation_id_idx
  on public.consultation_shares (consultation_id);

create index if not exists consultation_shares_created_by_idx
  on public.consultation_shares (created_by);

create index if not exists consultations_generation_id_idx
  on public.consultations (generation_id);

create index if not exists organization_invites_invited_by_idx
  on public.organization_invites (invited_by);

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);
