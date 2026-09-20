import * as cheerio from 'cheerio';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Endpoint routing
    if (url.pathname === '/api/schedule') {
      return handleSchedule(env);
    } else if (url.pathname === '/api/medals') {
      return handleMedals(env);
    }

    return new Response("Asian Games Proxy Worker Running", { status: 200 });
  }
};

async function handleSchedule(env) {
  const CACHE_KEY = "asiasportshub_schedule_cache";
  
  // 1. Check Cloudflare KV Cache (15 minutes TTL)
  const cached = await env.SCHEDULE_KV.get(CACHE_KEY);
  if (cached) {
    return createJsonResponse(JSON.parse(cached));
  }

  try {
    // 2. Fetch target page from Asia Sports Hub
    const res = await fetch("https://asiasportshub.com/asian-games-schedule/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CloudflarePagesWorker/1.0"
      }
    });
    
    if (!res.ok) throw new Error("Failed to fetch source page");
    const html = await res.text();
    const $ = cheerio.load(html);
    
    const events = [];

    // 3. Parse tables or schedules dynamically from the DOM structure
    $('table tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 2) {
        const date = $(cols[0]).text().trim();
        const detail = $(cols[1]).text().trim();
        if (date && detail) {
          events.push({ id: `ev-${i}`, date, detail });
        }
      }
    });

    // Fallback parser if data blocks use custom div structures instead of standard tables
    if (events.length === 0) {
      $('.schedule-item, .event-row').each((i, el) => {
        events.push({
          id: `ev-div-${i}`,
          title: $(el).text().trim()
        });
      });
    }

    const payload = { updated: new Date().toISOString(), events };
    
    // 4. Save to Cloudflare KV for 15 minutes (900 seconds)
    await env.SCHEDULE_KV.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 900 });

    return createJsonResponse(payload);
  } catch (err) {
    return createJsonResponse({ error: err.message, events: [] }, 500);
  }
}

async function handleMedals(env) {
  // Similar scraping logic can be applied to medal tables
  return createJsonResponse({ status: "Coming soon" });
}

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
