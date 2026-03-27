-- =============================================
-- BahaAlert: flood_stations table
-- Run this in Supabase SQL Editor
-- =============================================

-- Create the flood_stations table
CREATE TABLE IF NOT EXISTS flood_stations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  river TEXT NOT NULL,
  river_level DOUBLE PRECISION NOT NULL DEFAULT 0,
  river_max DOUBLE PRECISION NOT NULL DEFAULT 10,
  flood_status TEXT NOT NULL DEFAULT 'normal' CHECK (flood_status IN ('normal', 'warning', 'critical')),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT DEFAULT 'system'
);

-- Enable Row Level Security
ALTER TABLE flood_stations ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anon key can read)
CREATE POLICY "Public read access" ON flood_stations
  FOR SELECT USING (true);

-- Allow authenticated/anon inserts and updates (for admin dashboard with anon key)
CREATE POLICY "Allow insert" ON flood_stations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update" ON flood_stations
  FOR UPDATE USING (true) WITH CHECK (true);

-- Create index for fast lookups
CREATE INDEX idx_flood_stations_name ON flood_stations (name);

-- Seed with the 20 monitoring cities (initial data matching current hardcoded values)
INSERT INTO flood_stations (name, region, lat, lng, river, river_level, river_max, flood_status) VALUES
  -- NCR
  ('Marikina',       'ncr',      14.6507, 121.1029, 'Marikina River',       19.8, 20.0, 'critical'),
  ('Manila',         'ncr',      14.5995, 120.9842, 'Pasig River',           3.1,  4.5,  'warning'),
  ('Caloocan',       'ncr',      14.7294, 120.9732, 'Tullahan River',        5.2,  5.5,  'critical'),
  ('Quezon City',    'ncr',      14.6760, 121.0437, 'San Juan River',        2.8,  4.0,  'warning'),
  ('Pasig',          'ncr',      14.5764, 121.0851, 'Pasig River',           3.0,  4.5,  'normal'),
  -- Luzon
  ('Tuguegarao',     'luzon',    17.6132, 121.7270, 'Cagayan River',         8.7, 10.0, 'warning'),
  ('San Fernando',   'luzon',    15.0285, 120.6899, 'Pampanga River',        6.1,  8.0, 'warning'),
  ('Naga',           'luzon',    13.6218, 123.1945, 'Bicol River',           7.3,  9.5, 'warning'),
  ('Legazpi',        'luzon',    13.1391, 123.7438, 'Yawa River',            3.2,  7.0, 'normal'),
  ('Dagupan',        'luzon',    16.0433, 120.3333, 'Agno River',            4.5,  9.0, 'normal'),
  -- Visayas
  ('Cebu City',      'visayas',  10.3157, 123.8854, 'Butuanon River',        2.1,  5.0, 'normal'),
  ('Iloilo City',    'visayas',  10.7202, 122.5621, 'Jalaur River',          5.5,  7.2, 'warning'),
  ('Tacloban',       'visayas',  11.2543, 125.0000, 'Surigao River',         8.9,  9.0, 'critical'),
  ('Bacolod',        'visayas',  10.6770, 122.9570, 'Ilog River',            2.8,  7.0, 'normal'),
  -- Mindanao
  ('Davao City',     'mindanao',  7.0644, 125.5978, 'Davao River',           3.5,  9.0, 'normal'),
  ('Cagayan de Oro', 'mindanao',  8.4822, 124.6472, 'Cagayan de Oro River',  6.8, 10.0, 'warning'),
  ('Cotabato',       'mindanao',  7.2047, 124.2310, 'Mindanao River',        9.2, 12.0, 'warning'),
  ('Butuan',         'mindanao',  8.9500, 125.5400, 'Agusan River',         10.1, 13.0, 'warning'),
  ('Zamboanga',      'mindanao',  6.9214, 122.0790, 'Great Sta. Cruz River', 2.3,  6.0, 'normal'),
  ('General Santos', 'mindanao',  6.1164, 125.1716, 'Buayan River',          1.9,  5.5, 'normal')
ON CONFLICT (name) DO NOTHING;

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON flood_stations
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();
