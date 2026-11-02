-- All browser-facing data access goes through authenticated Next.js routes.
-- Direct PostgREST access remains closed unless an explicit policy is added.
alter table public.users enable row level security;
alter table public.credit_usage enable row level security;
alter table public.effect enable row level security;
alter table public.effect_result enable row level security;
alter table public.payment_history enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.curtain_skus enable row level security;
alter table public.curtain_fabrics enable row level security;
alter table public.curtain_styles enable row level security;
alter table public.curtain_generations enable row level security;
alter table public.curtain_knowledge_docs enable row level security;
alter table public.curtain_agent_recommendations enable row level security;
