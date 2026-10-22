CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_uidx
  ON users (lower(btrim(email)));
