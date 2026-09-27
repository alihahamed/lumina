-- Lumina spatial memory. Schema and rationale: PRD.md section 7.
-- Descriptors are pinned at 512 dims (CLIP ViT-B/32) because HNSW caps at 2000.

create extension if not exists vector;

create table routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null default auth.uid(),
  name text not null,
  created_at timestamptz default now()
);

create table anchors (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references routes on delete cascade not null,
  seq int not null,
  label text,                     -- "library door", spoken by the user
  ar_anchor_id text,              -- ARCore Cloud Anchor id
  pose jsonb,                     -- {x,y,z,qx,qy,qz,qw} from VIO
  descriptor vector(512) not null -- CLIP ViT-B/32, L2-normalized
);

create index on anchors using hnsw (descriptor vector_cosine_ops);
create index on anchors (route_id, seq);

-- A user only ever sees their own routes, and anchors through their routes.
alter table routes enable row level security;
alter table anchors enable row level security;

create policy "own routes" on routes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own anchors" on anchors
  for all
  using (exists (select 1 from routes r where r.id = anchors.route_id and r.user_id = auth.uid()))
  with check (exists (select 1 from routes r where r.id = anchors.route_id and r.user_id = auth.uid()));

-- Deliberately security invoker (the default): RLS applies to the caller, so a user
-- cannot match against someone else's route even by guessing its id.
create function match_anchors(query vector(512), route uuid, k int)
returns table (id uuid, label text, ar_anchor_id text, similarity float)
language sql stable as $$
  select id, label, ar_anchor_id, 1 - (descriptor <=> query)
  from anchors where route_id = route
  order by descriptor <=> query limit k;
$$;
