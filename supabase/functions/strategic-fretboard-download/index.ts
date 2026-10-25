import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://strategicfretboard.com";
const BUCKET_NAME = "strategic-fretboard-downloads";
const APK_FILE = "Strategic-Fretboard-Android-v2.2.0.apk";
const STRIPE_PRICE_ID = "price_1Rq8svDbmvIEli9Z5rorCzxC";
const EXPECTED_AMOUNT = 1299;
const EXPECTED_CURRENCY = "usd";
const LINK_LIFETIME_SECONDS = 10 * 60;

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
  const stripeKey = Deno.env.get("STRATEGIC_FRETBOARD_STRIPE_SECRET_KEY") ?? "";

  if (!supabaseUrl || !publishableKey || !secretKey || !stripeKey) {
    console.error("Required server configuration is missing.");
    return json({ error: "Purchase verification is temporarily unavailable." }, 503);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = await request.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  let purchaserEmail = "";

  if (sessionId) {
    if (!sessionId.startsWith("cs_")) return json({ error: "Invalid purchase session." }, 400);

    try {
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (
        session.payment_status !== "paid" ||
        session.status !== "complete" ||
        session.mode !== "payment" ||
        session.amount_total !== EXPECTED_AMOUNT ||
        session.currency !== EXPECTED_CURRENCY
      ) {
        return json({ error: "This purchase is not ready for download." }, 403);
      }

      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 20 });
      const purchasedApp = lineItems.data.some((item) => item.price?.id === STRIPE_PRICE_ID);
      if (!purchasedApp) return json({ error: "This purchase does not include Strategic Fretboard." }, 403);

      purchaserEmail = session.customer_details?.email?.trim().toLowerCase() ?? "";
    } catch (error) {
      console.error("Stripe session verification failed", error);
      return json({ error: "We could not confirm this Stripe purchase." }, 403);
    }
  } else {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ error: "A verified purchase or signed-in email is required." }, 401);
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    purchaserEmail = userData.user?.email?.trim().toLowerCase() ?? "";
    if (userError || !purchaserEmail) return json({ error: "Your verification link has expired." }, 401);

    const { data: subscriber, error: lookupError } = await admin
      .from("subscribers")
      .select("email")
      .eq("email", purchaserEmail)
      .eq("status", "active")
      .maybeSingle();

    if (lookupError) {
      console.error("Subscriber lookup failed", lookupError);
      return json({ error: "Purchase verification is temporarily unavailable." }, 503);
    }
    if (!subscriber) return json({ error: "No completed purchase was found for this email." }, 403);
  }

  const { data, error } = await admin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(APK_FILE, LINK_LIFETIME_SECONDS, { download: APK_FILE });

  if (error || !data?.signedUrl) {
    console.error("Signed download creation failed", error);
    return json({ error: "The Android download is temporarily unavailable." }, 503);
  }

  return json({
    downloadUrl: data.signedUrl,
    expiresIn: LINK_LIFETIME_SECONDS,
    purchaserEmail,
  });
});
