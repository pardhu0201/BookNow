-- Bookings paid together share a payment reference (the order id).
CREATE INDEX bookings_by_payment_ref ON bookings (payment_ref) WHERE payment_ref IS NOT NULL;
