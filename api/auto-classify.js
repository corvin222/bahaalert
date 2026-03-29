// /api/auto-classify.js
// Vercel serverless function — runs on a cron schedule (every 10 min)
// Fetches OpenWeatherMap data for each station, checks community reports,
// and auto-updates flood_stations in Supabase.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dqjdnjutsxerqkpepbri.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const OWM_KEY = process.env.OWM_API_KEY || '751e43c3eba5e441f025126d4252c4fc';

const sbHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation'
};

// ── RAIN → FLOOD STATUS CLASSIFICATION ──
function classifyByRain(rainMm) {
  if (rainMm >= 10) return 'critical';   // Heavy rain: >10mm/hr
  if (rainMm >= 4)  return 'warning';    // Moderate rain: 4-10mm/hr
  return 'normal';
}

// ── FETCH WEATHER FOR A STATION ──
async function fetchWeather(lat, lng) {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OWM_KEY}&units=metric`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── COUNT RECENT COMMUNITY REPORTS FOR AN AREA ──
async function getRecentReports(stationName) {
  try {
    // Get reports from the last 3 hours mentioning this city
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reports?created_at=gte.${threeHoursAgo}&location=ilike.*${encodeURIComponent(stationName)}*&select=depth,created_at&order=created_at.desc&limit=20`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ── CLASSIFY BASED ON COMMUNITY REPORTS ──
function classifyByReports(reports) {
  if (!reports || reports.length === 0) return null; // No override

  const criticalDepths = ['Dibdib', 'Chest', 'Bubong', 'Roof', 'Above head', 'Lagpas ulo'];
  const warningDepths = ['Baywang', 'Waist', 'Tuhod', 'Knee', 'Hita', 'Thigh'];

  const criticalCount = reports.filter(r =>
    criticalDepths.some(d => (r.depth || '').toLowerCase().includes(d.toLowerCase()))
  ).length;

  const warningCount = reports.filter(r =>
    warningDepths.some(d => (r.depth || '').toLowerCase().includes(d.toLowerCase()))
  ).length;

  // 3+ critical-depth reports → critical override
  if (criticalCount >= 3) return 'critical';
  // 3+ warning-depth reports → at least warning
  if (warningCount >= 3) return 'warning';
  // 5+ reports of any kind → warning
  if (reports.length >= 5) return 'warning';

  return null; // Not enough reports to override
}

// ── MAIN HANDLER ──
module.exports = async function handler(req, res) {
  // Optional: verify cron secret for security
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Fetch all stations
    const stationsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/flood_stations?select=*&order=name`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!stationsRes.ok) throw new Error(`Failed to fetch stations: ${stationsRes.status}`);
    const stations = await stationsRes.json();

    const results = [];

    for (const station of stations) {
      // Skip stations manually updated in the last 2 hours (admin override)
      if (station.updated_by && station.updated_by !== 'auto' && station.updated_by !== 'system') {
        const updatedAt = new Date(station.updated_at).getTime();
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        if (updatedAt > twoHoursAgo) {
          results.push({ name: station.name, status: station.flood_status, source: 'admin-override (skipped)' });
          continue;
        }
      }

      // 2. Fetch weather data
      const weather = await fetchWeather(station.lat, station.lng);
      const rain = weather?.rain?.['1h'] || 0;
      const weatherStatus = classifyByRain(rain);

      // 3. Estimate river level based on rainfall
      // River rises with rain, gradually drops when dry
      const currentLevel = station.river_level || 0;
      const maxLevel = station.river_max || 10;
      const baseLevel = maxLevel * 0.2; // Rivers don't go to zero — base is ~20% of max
      let estimatedLevel;

      if (rain > 0) {
        // Rain raises the level: heavier rain = faster rise
        // Each mm/hr of rain adds ~0.5-1.5% of max capacity per update cycle
        const riseRate = (rain / 15) * maxLevel * 0.15;
        estimatedLevel = Math.min(currentLevel + riseRate, maxLevel * 1.05);
      } else {
        // No rain: level slowly drops by ~2% per cycle (10 min), but not below base
        estimatedLevel = Math.max(currentLevel * 0.98, baseLevel);
      }
      // Round to 1 decimal
      estimatedLevel = Math.round(estimatedLevel * 10) / 10;

      // 4. Check community reports
      const reports = await getRecentReports(station.name);
      const reportStatus = classifyByReports(reports);

      // 5. Determine final status (highest severity wins)
      const severityOrder = { normal: 0, warning: 1, critical: 2 };
      let finalStatus = weatherStatus;
      let source = `weather (${rain.toFixed(1)}mm/hr)`;

      if (reportStatus && severityOrder[reportStatus] > severityOrder[finalStatus]) {
        finalStatus = reportStatus;
        source = `community (${reports.length} reports)`;
      }

      // 6. Update Supabase — always update river_level, only change status if different
      const updatePayload = {
        river_level: estimatedLevel,
        updated_by: 'auto'
      };
      if (finalStatus !== station.flood_status) {
        updatePayload.flood_status = finalStatus;
      }

      await fetch(
        `${SUPABASE_URL}/rest/v1/flood_stations?id=eq.${station.id}`,
        {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify(updatePayload)
        }
      );

      results.push({
        name: station.name,
        rain: `${rain.toFixed(1)}mm/hr`,
        level: `${estimatedLevel}m / ${maxLevel}m`,
        previousLevel: `${currentLevel}m`,
        weatherStatus,
        reportStatus: reportStatus || 'none',
        reportsCount: reports.length,
        finalStatus,
        statusChanged: finalStatus !== station.flood_status,
        source
      });
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      stations: results
    });

  } catch (err) {
    console.error('Auto-classify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
