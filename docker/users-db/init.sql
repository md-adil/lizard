-- users_service: demo microservice DB #1
CREATE ROLE lizard_read LOGIN PASSWORD 'lizard_read';
CREATE ROLE lizard_write LOGIN PASSWORD 'lizard_write';

CREATE TYPE lead_source AS ENUM ('web', 'referral', 'ads', 'event', 'cold_call');

CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'US',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  signup_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE customers IS 'People who signed up for the product';
COMMENT ON COLUMN customers.country IS 'ISO 3166-1 alpha-2 country code';

CREATE SCHEMA crm;
CREATE TABLE crm.leads (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES customers(id),
  source lead_source NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'lost')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE crm.leads IS 'Sales leads, optionally linked to a converted customer';

INSERT INTO customers (name, email, country, is_active, created_at)
SELECT
  (ARRAY['Ava','Liam','Mia','Noah','Zoe','Kai','Ivy','Leo','Ana','Max','Sara','Omar','Nina','Ravi','Lena','Hugo','Aria','Finn','Maya','Igor'])[1 + (g % 20)]
    || ' ' ||
  (ARRAY['Khan','Silva','Chen','Patel','Novak','Diaz','Kim','Rossi','Weber','Sato','Ali','Brown','Garcia','Ivanov','Okafor'])[1 + (g % 15)],
  'user' || g || '@example.com',
  (ARRAY['US','DE','IN','BR','JP','GB','FR','NG','AU','CA'])[1 + (g % 10)],
  g % 7 <> 0,
  now() - (g || ' days')::interval - ((g * 13) % 24 || ' hours')::interval
FROM generate_series(1, 120) AS g;

INSERT INTO crm.leads (customer_id, source, status, note, created_at)
SELECT
  CASE WHEN g % 3 = 0 THEN NULL ELSE 1 + (g * 7) % 120 END,
  (ARRAY['web','referral','ads','event','cold_call']::lead_source[])[1 + (g % 5)],
  (ARRAY['new','contacted','qualified','lost'])[1 + (g % 4)],
  CASE WHEN g % 4 = 0 THEN 'Followed up ' || g || ' times' ELSE NULL END,
  now() - ((g * 2) || ' days')::interval
FROM generate_series(1, 60) AS g;

GRANT USAGE ON SCHEMA public, crm TO lizard_read, lizard_write;
GRANT SELECT ON ALL TABLES IN SCHEMA public, crm TO lizard_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, crm TO lizard_write;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public, crm TO lizard_write;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lizard_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lizard_write;
