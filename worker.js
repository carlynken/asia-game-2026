// worker.js - Deploy to Cloudflare Workers
import * as cheerio from 'cheerio';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS Preflight Requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/api/schedule") {
      return handleScheduleRequest(env);
    }

    return new Response(JSON.stringify({ message: "Asian Games API Worker Active" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};

async function handleScheduleRequest(env) {
  const CACHE_KEY = "asiasportshub_schedule_data";
  
  // 1. Return cached payload if available in Cloudflare KV
  if (env.SCHEDULE_KV) {
    const cachedData = await env.SCHEDULE_KV.get(CACHE_KEY);
    if (cachedData) {
      return jsonResponse(JSON.parse(cachedData));
    }
  }

  try {
    // 2. Fetch HTML from target source
    const response = await fetch("https://asiasportshub.com/asian-games-schedule/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AsianGamesApp/2.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Target returned status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const events = [];

    // 3. Extract schedule data from HTML tables or container divs
    $('table tr').each((index, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 3) {
        const timeStr = $(cells[0]).text().trim();
        const sportName = $(cells[1]).text().trim();
        const eventTitle = $(cells[2]).text().trim();

        if (timeStr && sportName) {
          events.push({
            id: `ash-${index}`,
            time_utc8: new Date().toISOString().substring(0, 10) + "T" + (timeStr.includes(":") ? timeStr : "09:00") + ":00+08:00",
            sport_en: sportName,
            sport_zh: translateSportToZh(sportName),
            event_en: eventTitle || "Group Phase / Finals",
            event_zh: eventTitle || "小組賽 / 決賽",
            participants_en: "Competitors TBD",
            participants_zh: "待定選手",
            venue_en: "Aichi-Nagoya Main Venue",
            venue_zh: "愛知-名古屋主場館",
            is_medal: eventTitle.toLowerCase().includes("final") || eventTitle.toLowerCase().includes("gold"),
            is_live: false
          });
        }
      }
    });

    const payload = {
      source: "asiasportshub.com",
      fetched_at: new Date().toISOString(),
      count: events.length,
      events: events
    };

    // 4. Cache in Cloudflare KV for 15 minutes (900 seconds)
    if (env.SCHEDULE_KV && events.length > 0) {
      await env.SCHEDULE_KV.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 900 });
    }

    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ error: err.message, events: [] }, 500);
  }
}

function translateSportToZh(sportEn) {
  const map = {
    "Badminton": "羽毛球",
    "Basketball": "籃球",
    "Swimming": "游泳",
    "Table Tennis": "乒乓球",
    "Athletics": "田徑",
    "eSports": "電子競技",
    "Esports": "電子競技",
    "Fencing": "擊劍",
    "Wushu": "武術",
    "Judo": "柔道",
    "Volleyball": "排球",
    "Gymnastics": "體操"
  };
  return map[sportEn] || sportEn;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    }
  });
}
