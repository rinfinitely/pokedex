// Supabase Edge Function: api
// Public + authenticated REST API for GO Pokédex Tracker.
//
// Deploy:  supabase functions deploy api --no-verify-jwt
// Base:    https://<ref>.supabase.co/functions/v1/api
// Custom:  https://api.pokedex.world/  (via vercel.json rewrite)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const SB_URL = env("SUPABASE_URL");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON = env("SUPABASE_ANON_KEY") || SERVICE;

const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=15",
};

function json(data: unknown, status = 200, cache = "public, max-age=15") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, "Cache-Control": cache },
  });
}
function err(msg: string, status = 400) {
  return json({ error: msg }, status, "no-store");
}

const CARD_COLS =
  "user_id,username,bio,team,is_public,show_trade,caught,total,pct,shiny,special,trade,updated_at";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function authUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data?.user) return data.user;
  } catch (e) {
    console.error("auth.getUser (admin) failed", e);
  }
  try {
    const client = createClient(SB_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (!error && data?.user) return data.user;
    if (error) console.error("auth.getUser (anon) failed", error.message);
  } catch (e) {
    console.error("authUser fallback failed", e);
  }
  return null;
}


/** Require a logged-in admin (profiles.is_admin). Returns user or a Response error. */
async function requireAdmin(req: Request): Promise<{ user: any } | Response> {
  const user = await authUser(req);
  if (!user) {
    return err("Unauthorized — pass Authorization: Bearer <supabase-jwt>", 401);
  }
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,username,is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("requireAdmin profiles", error.message);
    return err("Could not verify admin status", 500);
  }
  if (!profile || !profile.is_admin) {
    return err("Forbidden — admin only", 403);
  }
  return { user: { ...user, username: profile.username, is_admin: true } };
}

async function resolveUsername(name: string, publicOnly = true) {
  const n = name.trim();
  if (!n || n.length > 40) return null;
  let q = admin.from("trainer_cards").select(CARD_COLS).ilike("username", n).limit(1);
  if (publicOnly) q = q.eq("is_public", true);
  const { data } = await q.maybeSingle();
  return data;
}

async function followCounts(userId: string) {
  try {
    const [a, b] = await Promise.all([
      admin.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
      admin.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId),
    ]);
    if (a.error || b.error) {
      console.error("follows query", a.error?.message || b.error?.message);
      return { followers: 0, following: 0 };
    }
    return { followers: a.count ?? 0, following: b.count ?? 0 };
  } catch (e) {
    console.error("followCounts", e);
    return { followers: 0, following: 0 };
  }
}

async function profilePayload(card: any, includeTrade = false) {
  const counts = await followCounts(card.user_id);
  const out: Record<string, unknown> = {
    id: card.user_id,
    username: card.username,
    bio: card.bio,
    team: card.team || null,
    is_public: card.is_public,
    show_trade: card.show_trade,
    stats: {
      caught: card.caught,
      total: card.total,
      pct: Number(card.pct),
      shiny: card.shiny,
      special: card.special,
    },
    followers: counts.followers,
    following: counts.following,
    updated_at: card.updated_at,
  };
  if (includeTrade && card.show_trade && card.trade) {
    out.trade = card.trade;
  }
  return out;
}

async function handleMe(req: Request) {
  const user = await authUser(req);
  if (!user) return err("Unauthorized — pass Authorization: Bearer <supabase-jwt>", 401);

  let profile: any = null;
  {
    const r1 = await admin.from("profiles").select("id,username,is_admin,banned").eq("id", user.id).maybeSingle();
    if (r1.error) console.error("profiles core", r1.error.message);
    profile = r1.data || null;
    if (profile) {
      const r2 = await admin.from("profiles").select("clan,name_color").eq("id", user.id).maybeSingle();
      if (!r2.error && r2.data) {
        profile.clan = r2.data.clan ?? null;
        profile.name_color = r2.data.name_color ?? null;
      } else {
        profile.clan = null;
        profile.name_color = null;
      }
    }
  }

  let card: any = null;
  {
    const r = await admin.from("trainer_cards").select(CARD_COLS).eq("user_id", user.id).maybeSingle();
    if (r.error) console.error("trainer_cards", r.error.message);
    else card = r.data;
  }

  let cloud: any = null;
  {
    const r = await admin.from("cloud_dex").select("dex,trade,updated_at").eq("user_id", user.id).maybeSingle();
    if (r.error) console.error("cloud_dex", r.error.message);
    else cloud = r.data;
  }

  let counts = { followers: 0, following: 0 };
  try {
    counts = await followCounts(user.id);
  } catch (e) {
    console.error("followCounts", e);
  }

  let badgeCount = 0;
  try {
    const { count, error } = await admin
      .from("user_badges")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (!error) badgeCount = count ?? 0;
  } catch {
    /* table may not exist yet */
  }

  return json(
    {
      id: user.id,
      email: user.email ?? null,
      username: profile?.username ?? card?.username ?? null,
      is_admin: !!profile?.is_admin,
      banned: !!profile?.banned,
      clan: profile?.clan ?? null,
      name_color: profile?.name_color ?? null,
      card: card
        ? {
            bio: card.bio,
            team: card.team || null,
            is_public: card.is_public,
            show_trade: card.show_trade,
            stats: {
              caught: card.caught,
              total: card.total,
              pct: Number(card.pct),
              shiny: card.shiny,
              special: card.special,
            },
            trade: card.trade,
            updated_at: card.updated_at,
          }
        : null,
      cloud: cloud
        ? {
            dex: cloud.dex,
            trade: cloud.trade,
            updated_at: cloud.updated_at,
          }
        : null,
      followers: counts.followers,
      following: counts.following,
      badge_count: badgeCount,
    },
    200,
    "private, no-store",
  );
}

async function handlePublicUser(username: string) {
  const card = await resolveUsername(username, true);
  if (!card) return err("User not found or profile is private", 404);
  return json(await profilePayload(card, true));
}

async function handleFollowList(username: string, direction: "followers" | "following") {
  const card = await resolveUsername(username, true);
  if (!card) return err("User not found or profile is private", 404);

  const isFollowers = direction === "followers";
  const col = isFollowers ? "follower_id" : "following_id";
  const other = isFollowers ? "following_id" : "follower_id";

  const { data: rows, error } = await admin
    .from("follows")
    .select(col)
    .eq(other, card.user_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return err(error.message, 500);
  const ids = (rows || []).map((r: any) => r[col]).filter(Boolean);
  if (!ids.length) return json({ username: card.username, count: 0, [direction]: [] });

  const { data: cards } = await admin
    .from("trainer_cards")
    .select("user_id,username,bio,team,caught,total,pct,shiny,special,show_trade,updated_at")
    .eq("is_public", true)
    .in("user_id", ids);

  const map = new Map((cards || []).map((c: any) => [c.user_id, c]));
  const list = ids
    .map((id: string) => map.get(id))
    .filter(Boolean)
    .map((c: any) => ({
      id: c.user_id,
      username: c.username,
      bio: c.bio,
      team: c.team || null,
      stats: { caught: c.caught, total: c.total, pct: Number(c.pct), shiny: c.shiny, special: c.special },
      show_trade: c.show_trade,
      updated_at: c.updated_at,
    }));

  return json({ username: card.username, count: list.length, [direction]: list });
}

async function handleLeaderboard(url: URL) {
  const sort = (url.searchParams.get("sort") || "pct").toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const orderCol = sort === "caught" ? "caught" : sort === "shiny" ? "shiny" : "pct";

  const { data, error } = await admin
    .from("trainer_cards")
    .select("user_id,username,bio,team,caught,total,pct,shiny,special,show_trade,updated_at")
    .eq("is_public", true)
    .order(orderCol, { ascending: false })
    .order("caught", { ascending: false })
    .limit(limit);

  if (error) return err(error.message, 500);
  const leaderboard = (data || []).map((c: any) => ({
    id: c.user_id,
    username: c.username,
    bio: c.bio,
    team: c.team || null,
    stats: { caught: c.caught, total: c.total, pct: Number(c.pct), shiny: c.shiny, special: c.special },
    show_trade: c.show_trade,
    updated_at: c.updated_at,
  }));
  return json({ sort: orderCol, count: leaderboard.length, leaderboard });
}

async function handleTrades(username: string) {
  const card = await resolveUsername(username, true);
  if (!card) return err("User not found or profile is private", 404);
  if (!card.show_trade) return err("This trainer is not sharing their trade list", 403);
  return json({
    id: card.user_id,
    username: card.username,
    team: card.team || null,
    trade: card.trade,
    updated_at: card.updated_at,
  });
}

async function handleStats() {
  const [{ count: publicTrainers }, { data: top }, { count: followEdges }] = await Promise.all([
    admin.from("trainer_cards").select("*", { count: "exact", head: true }).eq("is_public", true),
    admin
      .from("trainer_cards")
      .select("pct,caught,shiny,special")
      .eq("is_public", true)
      .order("pct", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("follows").select("*", { count: "exact", head: true }),
  ]);

  return json({
    public_trainers: publicTrainers ?? 0,
    follow_edges: followEdges ?? 0,
    top_pct: top?.pct ?? null,
    top_caught: top?.caught ?? null,
    generated_at: new Date().toISOString(),
  });
}

async function handleUserById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err("Invalid user id", 400);
  const { data, error } = await admin
    .from("trainer_cards")
    .select(CARD_COLS)
    .eq("user_id", id)
    .eq("is_public", true)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("User not found or profile is private", 404);
  return json(await profilePayload(data, true));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return err("Only GET is supported", 405);
  }

  try {
    // Entire API is admin-only (is_admin on profiles). No anonymous access.
    const gate = await requireAdmin(req);
    if (gate instanceof Response) return gate;

    const url = new URL(req.url);
    let path = url.pathname.replace(/\/+$/, "");
    const idx = path.indexOf("/api");
    if (idx >= 0) path = path.slice(idx + 4);
    path = path.replace(/^\/+/, "") || "";
    const parts = path.split("/").filter(Boolean);

    if (parts.length === 0) {
      return json({
        name: "GO Pokédex Tracker API",
        version: 1,
        access: "admin-only",
        note: "All endpoints require Authorization: Bearer <supabase-jwt> of an is_admin user",
        endpoints: [
          "GET /me",
          "GET /users/me",
          "GET /users/:username",
          "GET /profile/:username",
          "GET /followers/:username",
          "GET /following/:username",
          "GET /leaderboard?sort=pct|caught|shiny&limit=50",
          "GET /trades/:username",
          "GET /stats",
          "GET /user/:uuid",
        ],
      });
    }

    if ((parts[0] === "me" && parts.length === 1) || (parts[0] === "users" && parts[1] === "me" && parts.length === 2)) {
      return await handleMe(req);
    }

    if (parts[0] === "users" && parts[1] && parts.length === 2) {
      return await handlePublicUser(parts[1]);
    }

    const [resource, param] = parts;
    switch (resource) {
      case "profile":
        if (!param) return err("username required");
        return await handlePublicUser(param);
      case "followers":
        if (!param) return err("username required");
        return await handleFollowList(param, "followers");
      case "following":
        if (!param) return err("username required");
        return await handleFollowList(param, "following");
      case "leaderboard":
        return await handleLeaderboard(url);
      case "trades":
        if (!param) return err("username required");
        return await handleTrades(param);
      case "stats":
        return await handleStats();
      case "user":
        if (!param) return err("user id required");
        return await handleUserById(param);
      default:
        return err("Unknown endpoint. See GET / for the list.", 404);
    }
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return err("Internal error: " + msg, 500);
  }
});