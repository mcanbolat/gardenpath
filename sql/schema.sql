-- Garden path advertising study: Supabase schema (applied as migration gp_garden_path_study)

create table if not exists public.gp_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  participant_id text,
  station text,
  eye_tracker boolean not null default false,
  layout_id int not null check (layout_id between 0 and 35),
  color_map jsonb not null,      -- {"GP":"blue","CA":"red","CB":"green"}
  page_order jsonb not null,     -- ["CB","GP","CA"] = sentence shown on ad page 1,2,3
  user_agent text,
  screen_w int, screen_h int, viewport_w int, viewport_h int, dpr numeric,
  is_test boolean not null default false,
  completed boolean not null default false,
  completed_at timestamptz,
  choice_sentence text,
  choice_color text,
  choice_position int,
  recall_text text,
  answers jsonb
);

create table if not exists public.gp_ad_measures (
  id bigserial primary key,
  session_id uuid not null references public.gp_sessions(id) on delete cascade,
  sentence_id text not null,
  color text not null,
  position int not null,
  dwell_ms numeric,
  visits int,
  first_visit_ms numeric,
  text_hover_ms numeric,
  rating_effective int check (rating_effective between 1 and 10),
  rating_clarity int check (rating_clarity between 1 and 7),
  error_judgment text,
  color_liking int check (color_liking between 1 and 7),
  unique (session_id, sentence_id)
);

create table if not exists public.gp_events (
  id bigserial primary key,
  session_id uuid not null references public.gp_sessions(id) on delete cascade,
  seq int not null,
  client_epoch_ms bigint not null,
  perf_ms numeric not null,
  page text not null,
  event text not null,
  detail jsonb,
  received_at timestamptz not null default now()
);
create index if not exists gp_events_session_idx on public.gp_events(session_id, seq);
create index if not exists gp_ad_measures_session_idx on public.gp_ad_measures(session_id);

alter table public.gp_sessions enable row level security;
alter table public.gp_ad_measures enable row level security;
alter table public.gp_events enable row level security;

create or replace function public.gp_start_session(
  p_participant_id text, p_station text, p_eye_tracker boolean, p_is_test boolean,
  p_user_agent text, p_screen_w int, p_screen_h int, p_viewport_w int, p_viewport_h int, p_dpr numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_layout int; v_id uuid;
  perms text[][] := array[
    array['GP','CA','CB'], array['GP','CB','CA'], array['CA','GP','CB'],
    array['CA','CB','GP'], array['CB','GP','CA'], array['CB','CA','GP']];
  colors text[] := array['red','blue','green'];
  a int; o int; v_colors jsonb; v_order jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('gp_assign'));
  select l.layout into v_layout
  from generate_series(0,35) as l(layout)
  left join public.gp_sessions s
    on s.layout_id = l.layout and not s.is_test
   and (s.completed or s.created_at > now() - interval '1 hour')
  group by l.layout
  order by count(s.id), random()
  limit 1;

  a := v_layout / 6 + 1;
  o := v_layout % 6 + 1;
  v_colors := jsonb_build_object(perms[a][1], colors[1], perms[a][2], colors[2], perms[a][3], colors[3]);
  v_order := jsonb_build_array(perms[o][1], perms[o][2], perms[o][3]);

  insert into public.gp_sessions(participant_id, station, eye_tracker, is_test, layout_id, color_map, page_order,
    user_agent, screen_w, screen_h, viewport_w, viewport_h, dpr)
  values (left(p_participant_id,100), left(p_station,50), coalesce(p_eye_tracker,false), coalesce(p_is_test,false),
    v_layout, v_colors, v_order, left(p_user_agent,400), p_screen_w, p_screen_h, p_viewport_w, p_viewport_h, p_dpr)
  returning id into v_id;

  return jsonb_build_object('session_id', v_id, 'layout_id', v_layout, 'color_map', v_colors, 'page_order', v_order);
end $$;

create or replace function public.gp_log_events(p_session uuid, p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.gp_sessions where id = p_session and not completed) then
    return 0;
  end if;
  if jsonb_array_length(p_events) > 500 then raise exception 'too many events'; end if;
  insert into public.gp_events(session_id, seq, client_epoch_ms, perf_ms, page, event, detail)
  select p_session, (e->>'seq')::int, (e->>'epoch')::bigint, (e->>'perf')::numeric,
         left(e->>'page',40), left(e->>'event',40), e->'detail'
  from jsonb_array_elements(p_events) e;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.gp_finish_session(p_session uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare m jsonb;
begin
  if not exists (select 1 from public.gp_sessions where id = p_session and not completed) then
    return false;
  end if;
  update public.gp_sessions set
    completed = true, completed_at = now(),
    choice_sentence = left(p_payload->>'choice_sentence',10),
    choice_color = left(p_payload->>'choice_color',10),
    choice_position = (p_payload->>'choice_position')::int,
    recall_text = left(p_payload->>'recall_text',4000),
    answers = p_payload->'answers'
  where id = p_session;
  for m in select * from jsonb_array_elements(p_payload->'ads') loop
    insert into public.gp_ad_measures(session_id, sentence_id, color, position, dwell_ms, visits, first_visit_ms,
      text_hover_ms, rating_effective, rating_clarity, error_judgment, color_liking)
    values (p_session, m->>'sentence_id', m->>'color', (m->>'position')::int, (m->>'dwell_ms')::numeric,
      (m->>'visits')::int, (m->>'first_visit_ms')::numeric, (m->>'text_hover_ms')::numeric,
      (m->>'rating_effective')::int, (m->>'rating_clarity')::int, left(m->>'error_judgment',10), (m->>'color_liking')::int);
  end loop;
  return true;
end $$;

revoke all on function public.gp_start_session(text,text,boolean,boolean,text,int,int,int,int,numeric) from public;
revoke all on function public.gp_log_events(uuid,jsonb) from public;
revoke all on function public.gp_finish_session(uuid,jsonb) from public;
grant execute on function public.gp_start_session(text,text,boolean,boolean,text,int,int,int,int,numeric) to anon, authenticated;
grant execute on function public.gp_log_events(uuid,jsonb) to anon, authenticated;
grant execute on function public.gp_finish_session(uuid,jsonb) to anon, authenticated;

create or replace view public.gp_analysis with (security_invoker = true) as
select s.id as session_id, s.participant_id, s.created_at, s.layout_id, s.eye_tracker,
       m.sentence_id, (m.sentence_id = 'GP') as garden_path, m.color, m.position,
       m.dwell_ms, m.visits, m.first_visit_ms, m.text_hover_ms,
       m.rating_effective, m.rating_clarity, m.error_judgment, m.color_liking,
       (s.choice_sentence = m.sentence_id) as chosen,
       s.answers
from public.gp_sessions s join public.gp_ad_measures m on m.session_id = s.id
where s.completed and not s.is_test;
revoke all on public.gp_analysis from anon, authenticated;
