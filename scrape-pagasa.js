// /api/scrape-pagasa.js
// Vercel serverless function — scrapes PAGASA FFWS water level data
// for the Pasig-Marikina-Tullahan river basin (Metro Manila)
// and updates flood_stations in Supabase.
//
// PAGASA source: https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/table.do
//
// Run every 15 minutes via Vercel cron.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dqjdnjutsxerqkpepbri.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const PAGASA_URL = 'https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/table.do';

const sbHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation'
};

// ── MAP PAGASA STATION NAMES → OUR STATION NAMES ──
// PAGASA uses specific gauge station names; we map them to our city names
const PAGASA_TO_CITY = {
  'sto. nino':      'Marikina',
  'sto. niño':      'Marikina',
  'marikina':       'Marikina',
  'montalban':      'Marikina',      // upstream of Marikina
  'rosario':        'Pasig',
  'rosario weir':   'Pasig',
  'napindan':       'Pasig',
  'pandacan':       'Manila',
  'manila':         'Manila',
  'delpan':         'Manila',
  'tullahan':       'Caloocan',
  'potrero':        'Caloocan',
  'quirino':        'Quezon City',
  'san juan':       'Quezon City',
  'marikina bridge':'Marikina',
};

// ── WATER LEVEL THRESHOLDS (meters) ──
// Based on PAGASA alert levels for Marikina River
const ALERT_LEVELS = {
  'Marikina':     { warning: 16.0, critical: 18.0, max: 22.0 },
  'Manila':       { warning: 2.5,  critical: 3.5,  max: 5.0 },
  'Pasig':        { warning: 2.5,  critical: 3.5,  max: 5.0 },
  'Caloocan':     { warning: 4.0,  critical: 5.0,  max: 6.0 },
  'Quezon City':  { warning: 2.5,  critical: 3.5,  max: 4.5 },
};

function classifyWaterLevel(level, cityName) {
  const thresholds = ALERT_LEVELS[cityName];
  if (!thresholds) return null;
  if (level >= thresholds.critical) return 'critical';
  if (level >= thresholds.warning) return 'warning';
  return 'normal';
}

// ── PARSE WATER LEVEL TABLE FROM HTML ──
function parseWaterLevels(html) {
  const results = [];
  
  // Simple regex-based parser for the PAGASA table
  // The table typically has columns: Station | River | Current Level | Trend | Alert Level
  const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
  if (!tableMatch) return results;

  for (const table of tableMatch) {
    // Extract rows
    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
    if (!rows) continue;

    for (const row of rows) {
      // Skip header rows
      if (row.includes('<th')) continue;
      
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (!cells || cells.length < 3) continue;

      // Extract text from cells
      const cellTexts = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
      
      const stationName = cellTexts[0]?.toLowerCase() || '';
      
      // Find the water level value (look for a number with decimal)
      let waterLevel = null;
      for (const text of cellTexts) {
        const num = parseFloat(text);
        if (!isNaN(num) && num > 0 && num < 100) {
          waterLevel = num;
          break;
        }
      }

      if (!waterLevel) continue;

      // Match to our city
      const cityName = Object.entries(PAGASA_TO_CITY).find(
        ([key]) => stationName.includes(key)
      )?.[1];

      if (cityName) {
        results.push({ station: stationName, city: cityName, waterLevel });
      }
    }
  }

  return results;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Fetch PAGASA water level page
    let html;
    try {
      const pagasaRes = await fetch(PAGASA_URL, {
        headers: {
          'User-Agent': 'BahaAlert/1.0 (Flood Monitoring; contact@bahaalert.ph)',
          'Accept': 'text/html'
        },
        signal: AbortSignal.timeout(10000) // 10s timeout
      });
      
      if (!pagasaRes.ok) {
        return res.status(200).json({ 
          success: false, 
          message: `PAGASA returned ${pagasaRes.status}. Site may be down.`,
          timestamp: new Date().toISOString()
        });
      }
      html = await pagasaRes.text();
    } catch (fetchErr) {
      return res.status(200).json({
        success: false,
        message: `Could not reach PAGASA: ${fetchErr.message}`,
        timestamp: new Date().toISOString()
      });
    }

    // 2. Parse water levels
    const readings = parseWaterLevels(html);
    
    if (readings.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No water level data found in PAGASA page. Format may have changed.',
        timestamp: new Date().toISOString()
      });
    }

    // 3. Group by city (take highest reading per city)
    const cityReadings = {};
    for (const r of readings) {
      if (!cityReadings[r.city] || r.waterLevel > cityReadings[r.city].waterLevel) {
        cityReadings[r.city] = r;
      }
    }

    // 4. Update Supabase for each matched city
    const updates = [];
    for (const [cityName, reading] of Object.entries(cityReadings)) {
      const status = classifyWaterLevel(reading.waterLevel, cityName);
      if (!status) continue;

      const thresholds = ALERT_LEVELS[cityName];

      try {
        await fetch(
          `${SUPABASE_URL}/rest/v1/flood_stations?name=eq.${encodeURIComponent(cityName)}`,
          {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({
              river_level: reading.waterLevel,
              river_max: thresholds?.max || reading.waterLevel * 1.5,
              flood_status: status,
              updated_by: 'pagasa-ffws'
            })
          }
        );
        updates.push({
          city: cityName,
          station: reading.station,
          level: reading.waterLevel,
          status,
          source: 'PAGASA FFWS'
        });
      } catch (updateErr) {
        console.error(`Failed to update ${cityName}:`, updateErr);
      }
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      rawReadings: readings.length,
      updates
    });

  } catch (err) {
    console.error('PAGASA scrape error:', err);
    return res.status(500).json({ error: err.message });
  }
}
