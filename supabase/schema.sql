-- شغّل هذا الملف مرة واحدة من Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('الدولار','اليورو','العملات الأخرى','الصكوك','الحوالات')),
  operation text not null check (operation in ('بيع','شراء')),
  amount text not null check (char_length(amount) between 1 and 60),
  price text check (char_length(price) <= 60),
  city text not null check (char_length(city) between 2 and 60),
  whatsapp text not null check (whatsapp ~ '^\+?[0-9 ]{9,16}$'),
  description text check (char_length(description) <= 280),
  status text not null default 'pending' check (status in ('pending','published','rejected','hidden')),
  fingerprint text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(), content text not null check (char_length(content) between 2 and 240),
  active boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security; alter table public.offers enable row level security; alter table public.news enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from admin_users where user_id=auth.uid()) $$;
drop policy if exists "public reads published offers" on public.offers;
create policy "public reads published offers" on public.offers for select using (status='published' or is_admin());
drop policy if exists "admins manage offers" on public.offers;
create policy "admins manage offers" on public.offers for all using (is_admin()) with check (is_admin());
drop policy if exists "public reads active news" on public.news;
create policy "public reads active news" on public.news for select using (active or is_admin());
drop policy if exists "admins manage news" on public.news;
create policy "admins manage news" on public.news for all using (is_admin()) with check (is_admin());

-- نقطة إدخال آمنة للزائر: لا تمنحه INSERT مباشرًا، وتمنع التكرار خلال ساعة.
create or replace function public.submit_offer(payload jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid; normalized_phone text; fp text;
begin
  normalized_phone := regexp_replace(coalesce(payload->>'whatsapp',''),'[^0-9+]','','g');
  if coalesce(payload->>'category','') not in ('الدولار','اليورو','العملات الأخرى','الصكوك','الحوالات')
    or coalesce(payload->>'operation','') not in ('بيع','شراء')
    or char_length(coalesce(payload->>'amount','')) not between 1 and 60
    or char_length(coalesce(payload->>'city','')) not between 2 and 60
    or normalized_phone !~ '^\+?[0-9]{9,15}$' then raise exception 'بيانات العرض غير صالحة.'; end if;
  fp := encode(digest(lower(normalized_phone||'|'||payload->>'category'||'|'||payload->>'amount'),'sha256'),'hex');
  if exists(select 1 from offers where fingerprint=fp and created_at>now()-interval '1 hour') then raise exception 'تم إرسال عرض مماثل مؤخرًا.'; end if;
  insert into offers(category,operation,amount,price,city,whatsapp,description,status,fingerprint)
  values(payload->>'category',payload->>'operation',payload->>'amount',nullif(left(payload->>'price',60),''),payload->>'city',normalized_phone,nullif(left(payload->>'description',280),''),'pending',fp) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.submit_offer(jsonb) from public; grant execute on function public.submit_offer(jsonb) to anon,authenticated;

-- بعد إنشاء مستخدم من Authentication، استبدل البريد ثم شغّل السطر التالي:
-- insert into public.admin_users(user_id) select id from auth.users where email='admin@example.com';
