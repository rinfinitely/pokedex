// Supabase Edge Function: push-notify
// Sends Web Push notifications (and fills the in-app 🔔 inbox) for:
//   • trade matches    – when another public trainer has what you want AND wants what you offer (max 3 per run, once a week per trainer)
//   • announcements    – an admin broadcast from the site (Insights → Settings)
//   • test             – "Send test notification" button
//
// Secrets (supabase secrets set NAME=value):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   create once with:  npx web-push generate-vapid-keys
//   VAPID_SUBJECT      e.g. mailto:you@example.com
//   CRON_SECRET        same long random string the other cron jobs use
//   SITE_URL           e.g. https://your-site (used for the click-through link)
// Deploy: supabase functions deploy push-notify --no-verify-jwt
// Cron (every 5 minutes) is in supabase/features.sql. Test: curl -X POST https://<ref>.supabase.co/functions/v1/push-notify -H "x-cron-secret: <CRON_SECRET>" -d '{}'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const CRON_SECRET = env("CRON_SECRET");
const SITE = env("SITE_URL", "/");
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
let vapidOK = false;
try { webpush.setVapidDetails(env("VAPID_SUBJECT", "mailto:admin@example.com"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY")); vapidOK = !!env("VAPID_PUBLIC_KEY") && !!env("VAPID_PRIVATE_KEY"); } catch (e) { console.warn("VAPID setup failed:", e); }

type Sub = { id: number; user_id: string; endpoint: string; p256dh: string; auth_key: string; tz: string; prefs: Record<string, boolean> };
const wants = (s: Sub, k: string) => (s.prefs ?? {})[k] !== false;

async function send(s: Sub, payload: Record<string, unknown>): Promise<boolean> {
  if (!vapidOK) return false;
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);   // browser unsubscribed
    else console.warn("push failed", e?.statusCode, e?.body ?? e?.message);
    return false;
  }
}
async function claim(key: string): Promise<boolean> { const { error } = await sb.from("push_log").insert({ key }); return !error; }   // false if already sent
async function inbox(userId: string, kind: string, title: string, body: string, url: string, dedupe: string) {
  await sb.from("notifications").upsert({ user_id: userId, kind, title: title.slice(0, 120), body: body.slice(0, 400), url: url.slice(0, 300), dedupe_key: dedupe }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
}
async function chunked<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>) { for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn)); }
const allSubs = async (): Promise<Sub[]> => ((await sb.from("push_subscriptions").select("*").limit(5000)).data ?? []) as Sub[];

const hit = (list: any[], x: any) => list.some((w) => +w.id === +x.id && (!w.v || w.v === "any" || w.v === x.v));
const lists = (t: any) => ({ want: Array.isArray(t?.want) ? t.want : [], offer: Array.isArray(t?.offer) ? t.offer : [] });
async function runMatches() {
  const subs = (await allSubs()).filter((s) => wants(s, "matches"));
  if (!subs.length) return 0;
  const { data: cards } = await sb.from("trainer_cards").select("user_id,username,trade").eq("is_public", true).eq("show_trade", true).limit(1000);
  if (!cards?.length) return 0;
  const week = Math.floor(Date.now() / 6048e5), byUser = new Map<string, Sub[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  let n = 0;
  await chunked([...byUser.entries()], 10, async ([uid, us]) => {
    const { data: cd } = await sb.from("cloud_dex").select("trade").eq("user_id", uid).maybeSingle();
    const mine = lists(cd?.trade); if (!mine.want.length || !mine.offer.length) return;
    const found: { card: any; give: any[]; take: any[] }[] = [];
    for (const c of cards) {
      if (c.user_id === uid) continue;
      const t = lists(c.trade), give = t.offer.filter((x: any) => hit(mine.want, x)), take = mine.offer.filter((x: any) => hit(t.want, x));
      if (give.length && take.length) found.push({ card: c, give, take });
    }
    found.sort((a, b) => Math.min(b.give.length, b.take.length) - Math.min(a.give.length, a.take.length));
    for (const m of found.slice(0, 3)) {
      if (!(await claim(`match:${uid}:${m.card.user_id}:${week}`))) continue;
      const title = `🤝 Trade match with ${m.card.username}`, body = `They have ${m.give.length} Pokémon you want and want ${m.take.length} of yours.`;
      await inbox(uid, "match", title, body, "?view=trade", `match:${m.card.user_id}:${week}`);
      for (const s of us) if (await send(s, { title, body, url: SITE + "?view=trade", tag: "match-" + m.card.user_id })) n++;
    }
  });
  return n;
}

async function userFrom(req: Request) {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const { data } = await sb.auth.getUser(tok);
  if (!data?.user) return null;
  const { data: p } = await sb.from("profiles").select("is_admin").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, admin: !!p?.is_admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const cron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  const user = cron ? null : await userFrom(req);
  if (!cron && !user) return json({ error: "Not allowed" }, 401);
  if (!vapidOK) return json({ ok: false, error: "VAPID keys are not set on the function (see SETUP-FEATURES.md)." }, 500);
  try {
    if (body?.test && user) {
      const subs = (await allSubs()).filter((s) => s.user_id === user.id);
      let n = 0; for (const s of subs) if (await send(s, { title: "🔔 Push is working", body: "You'll get trade matches and announcements here.", url: SITE, tag: "test" })) n++;
      return json({ ok: true, sent: n, devices: subs.length });
    }
    if (body?.broadcast && user?.admin) {
      const b = body.broadcast, title = String(b.title ?? "").slice(0, 100), text = String(b.body ?? "").slice(0, 300);
      if (!title) return json({ ok: false, error: "A title is required." }, 400);
      const url = /^(\?|\/|https:\/\/)/.test(String(b.url ?? "")) ? String(b.url).slice(0, 300) : "";
      const subs = (await allSubs()).filter((s) => wants(s, "announce")), stamp = Date.now();
      const users = ((await sb.from("profiles").select("id").limit(5000)).data ?? []).map((p: any) => p.id as string);   // everyone gets it in their 🔔 inbox
      await chunked(users, 25, (u) => inbox(u, "announce", title, text, url, "announce:" + stamp));
      let n = 0; await chunked(subs, 20, async (s) => { if (await send(s, { title: "📣 " + title, body: text, url: url.startsWith("http") ? url : SITE + url, tag: "announce" })) n++; });
      return json({ ok: true, sent: n, users: users.length });
    }
    if (!cron) return json({ error: "Not allowed" }, 403);
    const matches = await runMatches();
    return json({ ok: true, matches });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
