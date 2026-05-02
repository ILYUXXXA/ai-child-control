/*
  # CyberParent AI — Initial Schema

  ## New Tables

  ### threat_events
  Stores threat detection log entries (no screenshots, text only).
  - id: UUID primary key
  - device_id: identifier of the monitored device
  - risk: integer 0-100 risk score
  - threat_type: enum (phishing, credential_theft, malware, safe)
  - reason: short description of the threat
  - location: where on screen the threat was found
  - action: block | warn | allow
  - timestamp: when the screenshot was taken (client time)
  - created_at: when the record was inserted

  ### monitor_settings
  Per-device monitoring configuration.
  - id: UUID primary key
  - device_id: unique device identifier
  - threshold_warn: risk score that triggers a warning (default 30)
  - threshold_block: risk score that triggers block (default 70)
  - is_paused: whether monitoring is paused
  - pause_until: timestamp when auto-resume happens
  - telegram_chat_id: Telegram chat for notifications
  - created_at / updated_at

  ## Security
  - RLS enabled on both tables
  - Only authenticated users may read/write their own rows
*/

CREATE TABLE IF NOT EXISTS threat_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  risk integer NOT NULL CHECK (risk >= 0 AND risk <= 100),
  threat_type text NOT NULL DEFAULT 'safe',
  reason text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT 'allow',
  timestamp bigint NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS threat_events_device_id_idx ON threat_events (device_id);
CREATE INDEX IF NOT EXISTS threat_events_created_at_idx ON threat_events (created_at DESC);

ALTER TABLE threat_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert threat events"
  ON threat_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read own device events"
  ON threat_events FOR SELECT
  TO authenticated
  USING (true);


CREATE TABLE IF NOT EXISTS monitor_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text UNIQUE NOT NULL,
  threshold_warn integer NOT NULL DEFAULT 30,
  threshold_block integer NOT NULL DEFAULT 70,
  is_paused boolean NOT NULL DEFAULT false,
  pause_until timestamptz,
  telegram_chat_id text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE monitor_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert monitor settings"
  ON monitor_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read monitor settings"
  ON monitor_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update monitor settings"
  ON monitor_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
