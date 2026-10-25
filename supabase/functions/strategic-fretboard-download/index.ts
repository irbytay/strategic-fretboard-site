import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://strategicfretboard.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "strategic-fretboard-downloads";
const FILE = "Strategic-Fretboard-Android-v2.2.0.apk";
const LINK_LIFETIME = 10 * 60;

function firstKey(packed: string): string {
  try {
    const keys = JSON.parse(packed);
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishable = Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    firstKey(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "");
  const authorization = request.headers.get("Authorization") ?? "";
  if (!url || !publishable || !secret || !authorization) {
    return Response.json({ error: "Authorization is required." }, { status: 401, headers: corsHeaders });
  }

  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const email = userData.user?.email?.trim().toLowerCase() ?? "";
  if (userError || !email) {
    return Response.json({ error: "Your verification link has expired." }, { status: 401, headers: corsHeaders });
  }

  const { data: subscriber, error: lookupError } = await admin.from("subscribers")
    .select("email,status,type").eq("email", email).eq("status", "active").maybeSingle();
  if (lookupError) {
    console.error("Subscriber lookup failed", lookupError);
    return Response.json({ error: "Purchase verification is temporarily unavailable." }, { status: 503, headers: corsHeaders });
  }
  if (!subscriber) {
    return Response.json({ error: "No completed Strategic Fretboard purchase was found for this email." }, { status: 403, headers: corsHeaders });
  }

  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(FILE, LINK_LIFETIME, { download: FILE });
  if (error || !data?.signedUrl) {
    console.error("Signed download creation failed", error);
    return Response.json({ error: "The Android download is temporarily unavailable." }, { status: 503, headers: corsHeaders });
  }

  return Response.json({ downloadUrl: data.signedUrl, expiresIn: LINK_LIFETIME }, {
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
});
