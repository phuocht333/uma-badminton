-- Refund obligations: created when admin approves a pass-slot refund (vote → hoan_tien).
-- Carries the amount snapshot so future price changes don't rewrite history.
-- paid_at + paid_by_user_id mark when admin actually transferred from quỹ.
CREATE TABLE refund_payments (
  vote_id TEXT PRIMARY KEY REFERENCES votes(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  paid_by_user_id TEXT REFERENCES users(id),
  paid_at INTEGER
);

CREATE INDEX refund_payments_unpaid_idx
  ON refund_payments(paid_at) WHERE paid_at IS NULL;
