const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession({ priceCents, successUrl, cancelUrl, metadata }) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Event seat' }, unit_amount: priceCents }, quantity: 1 }],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata
  });
  return session;
}

module.exports = { createCheckoutSession, stripe };
