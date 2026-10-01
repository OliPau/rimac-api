CREATE TABLE IF NOT EXISTS appointments (
  id CHAR(36) PRIMARY KEY,
  insured_id CHAR(5) NOT NULL,
  schedule_id BIGINT UNSIGNED NOT NULL,
  country_iso CHAR(2) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  UNIQUE KEY business_key (insured_id, country_iso, schedule_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  appointment_id CHAR(36) PRIMARY KEY,
  event_id CHAR(36) NOT NULL UNIQUE,
  payload LONGTEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

CREATE TABLE IF NOT EXISTS migrations (
  version VARCHAR(40) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO migrations (version) VALUES ('001');
