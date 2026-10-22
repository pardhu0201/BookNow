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
      async createCheckout({ booking, email }) {
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: email,
          client_reference_id: booking.id,
          metadata: { bookingId: booking.id },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: cfg.currency,
                unit_amount: booking.amount_minor,
                product_data: { name: `${booking.event_name}, seat ${booking.seat_key}` },
              },
            },
          ],
          expires_at: Math.floor(Date.now() / 1000) + STRIPE_MIN_SESSION_SECONDS,
          success_url: `${appUrl}/?payment=success&booking=${booking.id}`,
          cancel_url: `${appUrl}/?payment=cancelled&booking=${booking.id}`,
        });
        return { ref: session.id, url: session.url };
      },
      parseWebhook(rawBody, signature) {
        if (!cfg.stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
        return stripe.webhooks.constructEvent(rawBody, signature, cfg.stripeWebhookSecret);
      },
      async refund(paymentIntentId) {
        if (paymentIntentId) await stripe.refunds.create({ payment_intent: paymentIntentId });
      },
    };
  }

  return {
    provider: 'mock',
    async createCheckout({ booking }) {
      return { ref: `mock_${crypto.randomUUID()}`, url: `${appUrl}/checkout/mock/${booking.id}` };
    },
    parseWebhook() {
      throw new AppError(404, 'not_found', 'Stripe is not configured on this server.');
    },
    async refund() {},
  };
}

module.exports = { createPayments };
