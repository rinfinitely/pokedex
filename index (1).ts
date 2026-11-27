// Supabase Edge Function: patreon-sync
// Keeps the site's donation goal bar ("Raised so far") in step with your Patreon automatically.
// It asks Patreon's API for your members, adds their pledges up, and writes the total into site_settings → donation_goal.
// The bar on the site then updates by itself (live, for everyone who has the page open).
//
// Ways it gets triggered (use one or both):
//   1. Patreon webhook  – Patreon calls this function the moment someone pledges / changes / cancels (near-instant).
//   2. A schedule       – pg_cron calls it every 10-15 minutes as a safety net (see supabase/update-nov.sql).
//   3. The "Sync from Patreon now" button in Insights → Settings (admin only).
//
// Secrets (supabase secrets set NAME=value):
//   PATREON_ACCESS_TOKEN    required  - Patreon → developers → your client → "Creator's Access Token" (needs campaigns + campaigns.members)
//   PATREON_CAMPAIGN_ID     optional  - found automatically when you only have one campaign
//   PATREON_WEBHOOK_SECRET  optional  - the secret Patreon shows for the webhook you create (needed only for webhook calls)
//   PATREON_GOAL_MODE       optional  - "monthly" (default): what active patrons currently pledge per month
//                                       "lifetime": everything every member has ever paid in total
//   CRON_SECRET             required for scheduled calls (same one the other functions use)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy: supabase functions deploy patreon-sync --no-verify-jwt
// Test:   curl -X POST https://<ref>.supabase.co/functions/v1/patreon-sync -H "x-cron-secret: <CRON_SECRET>" -d '{}'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const TOKEN = env("PATREON_ACCESS_TOKEN");
const CAMPAIGN = env("PATREON_CAMPAIGN_ID");
const WEBHOOK_SECRET = env("PATREON_WEBHOOK_SECRET");
const MODE = env("PATREON_GOAL_MODE", "monthly").toLowerCase() === "lifetime" ? "lifetime" : "monthly";
const CRON_SECRET = env("CRON_SECRET");
const API = "https://www.patreon.com/api/oauth2/v2";

const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-patreon-signature, x-patreon-event", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function pget(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN, "User-Agent": "godex-patreon-sync" } });
  if (!r.ok) throw new Error(`Patreon answered ${r.status}${r.status === 401 ? " — the access token is wrong or expired" : r.status === 403 ? " — the token is missing the campaigns.members permission" : ""}`);
  return r.json();
}

async function campaignId(): Promise<string> {
  if (CAMPAIGN) return CAMPAIGN;
  const j = await pget(`${API}/campaigns`);
  const id = j?.data?.[0]?.id;
  if (!id) throw new Error("No Patreon campaign found for this token. Set PATREON_CAMPAIGN_ID.");
  return String(id);
}

// Adds up every member (follows Patreon's paging).
async function totals(): Promise<{ cents: number; patrons: number; members: number }> {
  const id = await campaignId();
  let url: string | null = `${API}/campaigns/${id}/members?fields%5Bmember%5D=patron_status,currently_entitled_amount_cents,campaign_lifetime_support_cents&page%5Bcount%5D=1000`;
  let cents = 0, patrons = 0, members = 0, pages = 0;
  while (url && pages++ < 50) {
    const j = await pget(url);
    for (const m of j?.data ?? []) {
      const a = m?.attributes ?? {};
      members++;
      const active = a.patron_status === "active_patron";
      if (active) patrons++;
      if (MODE === "lifetime") cents += Math.max(0, Number(a.campaign_lifetime_support_cents) || 0);
      else if (active) cents += Math.max(0, Number(a.currently_entitled_amount_cents) || 0);
    }
    const next: string | undefined = j?.links?.next;
    url = next && /^https:\/\/www\.patreon\.com\//.test(next) ? next : null;
  }
  return { cents, patrons, members };
}

async function isAdmin(req: Request): Promise<boolean> {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tok) return false;
  const { data } = await sb.auth.getUser(tok);
  if (!data?.user) return false;
  const { data: p } = await sb.from("profiles").select("is_admin").eq("id", data.user.id).maybeSingle();
  return !!p?.is_admin;
}

// Patreon signs webhook bodies with HMAC-MD5 (hex) using the webhook secret.
function validSignature(raw: string, sig: string): boolean {
  if (!WEBHOOK_SECRET || !sig) return false;
  const want = createHmac("md5", WEBHOOK_SECRET).update(raw).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(sig.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const sig = req.headers.get("x-patreon-signature") ?? "";
  const viaWebhook = !!sig;
  const cron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (viaWebhook ? !validSignature(raw, sig) : !(cron || (await isAdmin(req)))) return json({ error: "unauthorized" }, 401);
  if (!TOKEN) return json({ ok: false, error: "PATREON_ACCESS_TOKEN is not set on the function (see SETUP-FEATURES.md)." }, 500);

  try {
    const { data: row } = await sb.from("site_settings").select("value").eq("key", "donation_goal").maybeSingle();
    const old: Record<string, unknown> = (row?.value as Record<string, unknown>) ?? { enabled: true, title: "Monthly hosting", goal: 50, currency: "$", url: "", note: "" };
    if (old.auto === false) return json({ ok: false, error: "Automatic updates are switched off in Insights → Settings → Donation goal bar." }, 409);
    // a burst of webhook events (e.g. a tier change) only needs one sync
    const last = old.synced_at ? Date.parse(String(old.synced_at)) : 0;
    if (viaWebhook && Date.now() - last < 15_000) return json({ ok: true, skipped: "just synced" });

    const t = await totals();
    const current = Math.round(t.cents) / 100;
    const value = { ...old, auto: true, source: "patreon", mode: MODE, current, patrons: t.patrons, synced_at: new Date().toISOString() };
    const { error } = await sb.from("site_settings").upsert({ key: "donation_goal", value, updated_at: new Date().toISOString() });
    if (error) throw new Error("Could not save the goal: " + error.message + " (has supabase/features.sql been run?)");
    return json({ ok: true, mode: MODE, current, patrons: t.patrons, members: t.members });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
