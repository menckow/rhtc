-- Migration: Add iban and paypal to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS iban TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal TEXT;
