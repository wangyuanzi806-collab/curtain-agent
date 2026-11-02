create schema if not exists security;

create or replace function security.hook_allow_invited_user(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signup_email text := lower(nullif(event -> 'user' ->> 'email', ''));
begin
  if signup_email is not null and (
    exists (
      select 1
      from public.app_users as app_user
      join public.organization_members as member on member.user_id = app_user.id
      where lower(app_user.email) = signup_email
        and member.status = 'active'
    )
    or exists (
      select 1
      from public.organization_invites as invitation
      where lower(invitation.email) = signup_email
        and invitation.accepted_at is null
        and invitation.expires_at > now()
    )
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

revoke all on function security.hook_allow_invited_user(jsonb) from public, anon, authenticated;
grant usage on schema security to supabase_auth_admin;
grant execute on function security.hook_allow_invited_user(jsonb) to supabase_auth_admin;
