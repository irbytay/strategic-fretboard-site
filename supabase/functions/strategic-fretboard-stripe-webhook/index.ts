import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { withSupabase } from "npm:@supabase/server@^1";

const PRICE_ID = "price_1Rq8svDbmvIEli9Z5rorCzxC";
const EXPECTED_AMOUNT = 1299;
const EXPECTED_CURRENCY = "usd";
const stripe = new Stripe(
  Deno.env.get("STRATEGIC_FRETBOARD_STRIPE_SECRET_KEY") ?? "",
);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

export default {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        await request.text(),
        request.headers.get("stripe-signature") ?? "",
        Deno.env.get("STRATEGIC_FRETBOARD_STRIPE_WEBHOOK_SECRET") ?? "",
        undefined,
        cryptoProvider,
      );
    } catch (error) {
      console.error("Stripe signature verification failed", error);
      return new Response("Invalid signature", { status: 400 });
    }

    if (event.type !== "checkout.session.completed" &&
        event.type !== "checkout.session.async_payment_succeeded") {
      return Response.json({ received: true, ignored: true });
    }

    try {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "payment" || session.payment_status !== "paid") {
        return Response.json({ received: true, fulfilled: false });
      }
      if (session.amount_total !== EXPECTED_AMOUNT ||
          session.currency?.toLowerCase() !== EXPECTED_CURRENCY) {
        console.warn("Unexpected Strategic Fretboard payment total", {
          eventId: event.id,
          amount: session.amount_total,
          currency: session.currency,
        });
        return Response.json({ received: true, fulfilled: false });
      }

      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
      if (!lineItems.data.some((item) => item.price?.id === PRICE_ID)) {
        console.warn("Checkout did not contain the Strategic Fretboard price", { eventId: event.id });
        return Response.json({ received: true, fulfilled: false });
      }

      const email = (session.customer_details?.email ?? session.customer_email ?? "")
        .trim()
        .toLowerCase();
      if (!email) {
        console.warn("Paid checkout had no customer email", { eventId: event.id });
        return Response.json({ received: true, fulfilled: false });
      }

      const { error } = await context.supabaseAdmin.from("subscribers").upsert({
        email,
        status: "active",
        type: "paid",
        joined: new Date().toISOString(),
      }, { onConflict: "email" });
      if (error) throw error;

      return Response.json({ received: true, fulfilled: true });
    } catch (error) {
      console.error("Strategic Fretboard fulfillment failed", { eventId: event.id, error });
      return new Response("Fulfillment failed", { status: 500 });
    }
  }),
};
