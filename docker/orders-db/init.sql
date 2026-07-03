-- orders_service: demo microservice DB #2
CREATE ROLE lizard_read LOGIN PASSWORD 'lizard_read';
CREATE ROLE lizard_write LOGIN PASSWORD 'lizard_write';

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded');

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  attrs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE products IS 'Catalog of sellable products';

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL, -- lives in users_service.public.customers (cross-database; no real FK possible)
  status order_status NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE orders IS 'Customer orders; customer_id refers to the users service';
COMMENT ON COLUMN orders.customer_id IS 'ID of customers row in the users-service database';

CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL
);

INSERT INTO products (name, sku, price_cents, attrs)
SELECT
  (ARRAY['Terracotta Pot','Desk Lamp','Field Notebook','Espresso Cup','Wool Beanie','Canvas Tote','Gel Pen Set','Cork Coasters','Steel Bottle','Plant Mister'])[g],
  'SKU-' || lpad(g::text, 4, '0'),
  (ARRAY[1899, 4599, 1250, 1600, 2200, 2800, 950, 1400, 3100, 1750])[g],
  jsonb_build_object('color', (ARRAY['clay','black','kraft','white','grey','natural','blue','cork','steel','green'])[g])
FROM generate_series(1, 10) AS g;

INSERT INTO orders (customer_id, status, total_cents, currency, placed_at)
SELECT
  1 + (g * 11) % 120,
  (ARRAY['pending','paid','shipped','delivered','delivered','delivered','cancelled','refunded']::order_status[])[1 + (g % 8)],
  0,
  CASE WHEN g % 9 = 0 THEN 'EUR' ELSE 'USD' END,
  now() - ((g * 7) % 400 || ' days')::interval - ((g * 31) % 24 || ' hours')::interval
FROM generate_series(1, 300) AS g;

INSERT INTO order_items (order_id, product_id, qty, unit_price_cents)
SELECT
  o.id,
  1 + (o.id * s + s) % 10,
  1 + (o.id + s) % 4,
  p.price_cents
FROM orders o
CROSS JOIN generate_series(1, 3) AS s
JOIN products p ON p.id = 1 + (o.id * s + s) % 10
WHERE (o.id + s) % 3 <> 0;

UPDATE orders o
SET total_cents = COALESCE(t.total, 0)
FROM (
  SELECT order_id, SUM(qty * unit_price_cents) AS total
  FROM order_items GROUP BY order_id
) t
WHERE t.order_id = o.id;

GRANT USAGE ON SCHEMA public TO lizard_read, lizard_write;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lizard_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lizard_write;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO lizard_write;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lizard_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lizard_write;
