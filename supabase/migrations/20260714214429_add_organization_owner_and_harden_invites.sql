alter table public.organization_members
  drop constraint if exists organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('org_owner', 'org_admin', 'advisor'));

with owner_candidates as (
  select
    member.organization_id,
    member.user_id,
    row_number() over (
      partition by member.organization_id
      order by (app_user.auth_user_id is not null) desc, member.created_at asc, member.user_id asc
    ) as owner_rank
  from public.organization_members as member
  join public.app_users as app_user on app_user.id = member.user_id
  where member.role = 'org_admin'
    and member.status = 'active'
    and not exists (
      select 1
      from public.organization_members as existing_owner
      where existing_owner.organization_id = member.organization_id
        and existing_owner.role = 'org_owner'
    )
)
update public.organization_members as member
set role = 'org_owner', updated_at = now()
from owner_candidates as candidate
where member.organization_id = candidate.organization_id
  and member.user_id = candidate.user_id
  and candidate.owner_rank = 1;

create unique index if not exists organization_members_one_owner_per_org_idx
  on public.organization_members (organization_id)
  where role = 'org_owner';

create or replace function security.hook_allow_invited_user(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  signup_email text := lower(nullif(event -> 'user' ->> 'email', ''));
begin
  if signup_email is not null and exists (
    select 1
    from public.organization_invites as invitation
    where lower(invitation.email) = signup_email
      and invitation.accepted_at is null
      and invitation.expires_at > now()
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'Only invited staff accounts can be created.'
    )
  );
end;
$$;

revoke select (id, email) on table public.app_users from supabase_auth_admin;
revoke select (user_id, status) on table public.organization_members from supabase_auth_admin;

drop policy if exists "Auth hook reads staff identities" on public.app_users;
drop policy if exists "Auth hook reads organization membership" on public.organization_members;

revoke all on function security.hook_allow_invited_user(jsonb) from public, anon, authenticated;
grant usage on schema security to supabase_auth_admin;
grant execute on function security.hook_allow_invited_user(jsonb) to supabase_auth_admin;
