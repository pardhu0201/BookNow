'use strict';

const { AppError } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEAT_KEY = /^[A-Z][0-9]{1,2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AppError(400, 'invalid_input', `${name} must be a UUID.`);
  }
  return value.toLowerCase();
}

function seatKey(value) {
  if (typeof value !== 'string' || !SEAT_KEY.test(value)) {
    throw new AppError(400, 'invalid_input', 'seatKey must look like A1.');
  }
  return value;
}

function email(value) {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (trimmed.length > 254 || !EMAIL.test(trimmed)) {
    throw new AppError(400, 'invalid_input', 'A valid email address is required.');
  }
  return trimmed;
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new AppError(400, 'invalid_input', `${name} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

module.exports = { uuid, seatKey, email, oneOf, UUID };
