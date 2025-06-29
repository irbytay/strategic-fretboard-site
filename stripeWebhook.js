const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  const sig = event.headers['stripe-signature'];
  let webhookEvent;

  try {
    webhookEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  if (webhookEvent.type === 'checkout.session.completed') {
    const session = webhookEvent.data.object;
    const email = session.customer_email;

    // TODO: Replace with actual DB call (e.g. Supabase/Firebase)
    console.log(`✅ Stripe Checkout completed for: ${email}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  }

  console.log(`Ignored event type: ${webhookEvent.type}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ ignored: true }),
  };
};
