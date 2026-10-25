import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://strategicfretboard.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function firstKey(packedKeys: string): string {
  try {
    const keys = JSON.parse(packedKeys);
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    firstKey(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "");

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Required server configuration is missing.");
    return json({ error: "Administrator access is temporarily unavailable." }, 503);
  }

  const authorization = request.headers.get("Authorization")?.trim() ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!accessToken || accessToken.startsWith("sb_")) {
    return json({ error: "Sign in with Apple to continue." }, 401);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  const administrator = userData.user;
  const administratorEmail = normalizeEmail(administrator?.email);
  if (userError || !administrator || !administratorEmail) {
    console.error("Administrator session verification failed", userError);
    return json({ error: "Your administrator session is not valid." }, 401);
  }

  let { data: allowed, error: allowedError } = await admin
    .from("allowed_users")
    .select("email, role, user_id")
    .eq("user_id", administrator.id)
    .maybeSingle();

  if (!allowed && !allowedError) {
    const emailLookup = await admin
      .from("allowed_users")
      .select("email, role, user_id")
      .eq("email", administratorEmail)
      .maybeSingle();
    allowed = emailLookup.data;
    allowedError = emailLookup.error;
  }

  if (allowedError) {
    console.error("Administrator lookup failed", allowedError);
    return json({ error: "Administrator access could not be checked." }, 503);
  }
  if (!allowed || normalizeEmail(allowed.role) !== "admin") {
    return json({ error: "This Apple account is not authorized as an administrator." }, 403);
  }

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "status";
  if (action === "status") {
    return json({ ok: true, administratorEmail });
  }
  if (action !== "addComplimentary") {
    return json({ error: "Unknown administrator action." }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return json({ error: "Enter a complete email address." }, 400);

  const { error: upsertError } = await admin.from("subscribers").upsert({
    email,
    status: "active",
    type: "complimentary",
    joined: new Date().toISOString(),
  }, { onConflict: "email" });

  if (upsertError) {
    console.error("Complimentary access could not be saved", upsertError);
    return json({ error: "Complimentary access could not be saved." }, 503);
  }

  return json({ ok: true, email, status: "active", type: "complimentary" });
});
