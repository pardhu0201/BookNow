'use strict';

const crypto = require('node:crypto');
const Stripe = require('stripe');
const { AppError } = require('../errors');

const STRIPE_MIN_SESSION_SECONDS = 30 * 60;

// "stripe" when STRIPE_SECRET_KEY is set (test-mode Checkout), otherwise a
// built-in mock checkout so the live demo works with no payment account.
function createPayments(cfg, appUrl) {
  if (cfg.provider === 'stripe') {
    const stripe = new Stripe(cfg.stripeSecretKey);
    return {
      provider: 'stripe',
      async createCheckout({ bookings, email, eventId, eventName }) {
        const back = (outcome) => `${appUrl}/shows/${eventId}?payment=${outcome}&order={CHECKOUT_SESSION_ID}`;
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: email,
          metadata: { bookingIds: bookings.map((b) => b.id).join(','), eventId },
          line_items: bookings.map((b) => ({
            quantity: 1,
            price_data: {
              currency: cfg.currency,
              unit_amount: b.amount_minor,
              product_data: { name: `${eventName}, seat ${b.seat_key} (${b.tier})` },
            },
          })),
          expires_at: Math.floor(Date.now() / 1000) + STRIPE_MIN_SESSION_SECONDS,
          success_url: back('success'),
          cancel_url: back('cancelled'),
        });
        return { ref: session.id, url: session.url };
      },
      parseWebhook(rawBody, signature) {
        if (!cfg.stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
        return stripe.webhooks.constructEvent(rawBody, signature, cfg.stripeWebhookSecret);
      },
      // Partial refund: one seat of a multi-seat order.
      async refund(paymentIntentId, amountMinor) {
        if (paymentIntentId) await stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountMinor });
      },
    };
  }

  return {
    provider: 'mock',
    async createCheckout() {
      const ref = crypto.randomUUID();
      return { ref, url: `${appUrl}/checkout/${ref}` };
    },
    parseWebhook() {
      throw new AppError(404, 'not_found', 'Stripe is not configured on this server.');
    },
    async refund() {},
  };
}

module.exports = { createPayments };
