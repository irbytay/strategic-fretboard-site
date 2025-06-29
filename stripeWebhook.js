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
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  if (webhookEvent.type === 'checkout.session.completed') {
    const session = webhookEvent.data.object;
    const email = session.customer_email;

    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(__dirname, '../../data/subscribers.json');

    let subscribers = {};
    try {
      const file = fs.readFileSync(filePath);
      subscribers = JSON.parse(file);
    } catch (e) {
      subscribers = {};
    }

    subscribers[email] = {
      status: 'active',
      joined: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(subscribers, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ignored: true }),
  };
};stripeWebhook.js
