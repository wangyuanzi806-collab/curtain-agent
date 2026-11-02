grant select (id, email) on table public.app_users to supabase_auth_admin;
grant select (user_id, status) on table public.organization_members to supabase_auth_admin;
grant select (email, accepted_at, expires_at) on table public.organization_invites to supabase_auth_admin;

drop policy if exists "Auth hook reads staff identities" on public.app_users;
create policy "Auth hook reads staff identities"
on public.app_users
for select
to supabase_auth_admin
using (true);

drop policy if exists "Auth hook reads organization membership" on public.organization_members;
create policy "Auth hook reads organization membership"
on public.organization_members
for select
to supabase_auth_admin
using (true);

drop policy if exists "Auth hook reads pending invitations" on public.organization_invites;
create policy "Auth hook reads pending invitations"
on public.organization_invites
for select
to supabase_auth_admin
using (true);

alter function security.hook_allow_invited_user(jsonb) security invoker;

revoke all on function security.hook_allow_invited_user(jsonb) from public, anon, authenticated;
grant usage on schema security to supabase_auth_admin;
grant execute on function security.hook_allow_invited_user(jsonb) to supabase_auth_admin;
