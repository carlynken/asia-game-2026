// worker.js - Native Cloudflare Worker (Zero external dependencies)

export default {
  async fetch(request, env, ctx) {
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

    const url = new URL(request.url);
    if (url.pathname === "/api/schedule") {
      return handleScheduleRequest(env);
    }

    return jsonResponse({ message: "Asian Games API Worker Active" });
  }
};

async function handleScheduleRequest(env) {
  const CACHE_KEY = "asiasportshub_schedule_data";

  // 1. Check Cloudflare KV Cache
  if (env.SCHEDULE_KV) {
    const cachedData = await env.SCHEDULE_KV.get(CACHE_KEY);
    if (cachedData) {
      return jsonResponse(JSON.parse(cachedData));
    }
  }

  try {
    // 2. Fetch page HTML
    const response = await fetch("https://asiasportshub.com/asian-games-schedule/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AsianGamesApp/2.0"
      }
    });

    if (!response.ok) throw new Error(`Target returned status ${response.status}`);

    // 3. Parse HTML natively with Cloudflare's built-in HTMLRewriter
    const rawEvents = [];
    let currentCells = [];

    const rewriter = new HTMLRewriter()
      .on('table tr', {
        element() {
          if (currentCells.length >= 2) {
            rawEvents.push([...currentCells]);
          }
          currentCells = [];
        }
      })
      .on('table tr td', {
        text(textObj) {
          const content = textObj.text.trim();
          if (content) {
            currentCells.push(content);
          }
        }
      });

    // Run the rewriter through the response stream
    await rewriter.transform(response).text();

    // 4. Format parsed data
    const events = rawEvents.map((row, index) => {
      const timeStr = row[0] || "09:00";
      const sportName = row[1] || "General Event";
      const eventTitle = row[2] || "Matches / Finals";

      return {
        id: `ash-${index}`,
        time_utc8: new Date().toISOString().substring(0, 10) + "T" + (timeStr.includes(":") ? timeStr : "09:00") + ":00+08:00",
        sport_en: sportName,
        sport_zh: translateSportToZh(sportName),
        event_en: eventTitle,
        event_zh: eventTitle,
        participants_en: "Competitors TBD",
        participants_zh: "待定選手",
        venue_en: "Aichi-Nagoya Main Venue",
        venue_zh: "愛知-名古屋主場館",
        is_medal: eventTitle.toLowerCase().includes("final") || eventTitle.toLowerCase().includes("gold")
      };
    });

    const payload = {
      source: "asiasportshub.com",
      fetched_at: new Date().toISOString(),
      count: events.length,
      events: events
    };

    // 5. Save to KV Cache for 15 mins
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
    "Badminton": "羽毛球", "Basketball": "籃球", "Swimming": "游泳",
    "Table Tennis": "乒乓球", "Athletics": "田徑", "eSports": "電子競技",
    "Fencing": "擊劍", "Wushu": "武術", "Judo": "柔道", "Volleyball": "排球"
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
