export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, message, area, severity, url } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message required' });

  const payload = {
    app_id: '2d9ddea7-7c90-464f-9c41-de0976793025',
    included_segments: ['All'],
    headings: { en: title },
    contents: { en: message },
    url: url || 'https://bahaalert.vercel.app',
    web_url: url || 'https://bahaalert.vercel.app',
    priority: severity === 'critical' ? 10 : 5,
    ttl: 3600,
    data: { severity, area },
  };

  if (area && area !== 'All Philippines') {
    payload.filters = [{ field: 'tag', key: 'area', relation: '=', value: area }];
    delete payload.included_segments;
  }

  try {
    const r = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic os_v2_app_fwo55j34sbde7hcb3yexm6jqeuckvxb5rvzunjutnkbx55cggstkrpl66rr5ofxcgnpleb6toofewm4xmh6ndshzz2ixel6vip53kai',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (data.errors) return res.status(500).json({ error: data.errors });
    return res.status(200).json({ success: true, id: data.id, recipients: data.recipients });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
