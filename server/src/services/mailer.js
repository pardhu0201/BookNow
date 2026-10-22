'use strict';

const nodemailer = require('nodemailer');

const mask = (address) => address.replace(/^(.).*(@.*)$/, '$1***$2');

// send() never rejects: a mail outage must not crash the server or fail a booking.
function createMailer(smtp) {
  const transport = smtp.host
    ? nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      })
    : null;

  return {
    async send({ to, subject, text }) {
      if (!to) return false;
      if (!transport) {
        console.log(`[mail] SMTP not configured; skipped "${subject}" to ${mask(to)}`);
        return false;
      }
      try {
        await transport.sendMail({ from: smtp.from, to, subject, text });
        return true;
      } catch (err) {
        console.error(`[mail] failed to send "${subject}" to ${mask(to)}:`, err.message);
        return false;
      }
    },
  };
}

module.exports = { createMailer };
