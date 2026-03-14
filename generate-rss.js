const fs    = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const RSS   = require("rss");

const flareSolverrURL = process.env.FLARESOLVERR_URL || "http://localhost:8191";

fs.mkdirSync("./feeds", { recursive: true });

// ===== SITES =====
const SITES = [
  { name: "BBC Sky at Night Magazine", baseURL: "https://www.skyatnightmagazine.com", url: "https://www.skyatnightmagazine.com/news" },
  { name: "BBC Science Focus",         baseURL: "https://www.sciencefocus.com",        url: "https://www.sciencefocus.com/news"        },
  { name: "Discover Wildlife",          baseURL: "https://www.discoverwildlife.com",    url: "https://www.discoverwildlife.com/news"    },
];

// ===== DATE PARSING =====
function parseItemDate(raw) {
  if (!raw || !raw.trim()) return new Date();
  const trimmed = raw.trim();

  const relMatch = trimmed.match(/^(\d+)\s+(minute|hour|day)s?\s+ago$/i);
  if (relMatch) {
    const n    = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms   = unit === "minute" ? n * 60_000
               : unit === "hour"   ? n * 3_600_000
               :                     n * 86_400_000;
    return new Date(Date.now() - ms);
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  console.warn(`⚠️  Could not parse date: "${trimmed}" — using now()`);
  return new Date();
}

// ===== FLARESOLVERR =====
async function fetchWithFlareSolverr(url) {
  console.log(`Fetching ${url} via FlareSolverr...`);
  const response = await axios.post(
    `${flareSolverrURL}/v1`,
    { cmd: "request.get", url, maxTimeout: 60000 },
    { headers: { "Content-Type": "application/json" }, timeout: 65000 }
  );
  if (response.data?.solution) {
    console.log("✅ FlareSolverr successfully bypassed protection");
    return response.data.solution.response;
  }
  throw new Error("FlareSolverr did not return a solution");
}

// ===== PARSE ONE SITE =====
function parseSite($, baseURL) {
  const items = [];

  $('storefront-content[template="card"]').each((_, el) => {
    const $card = $(el);

    const titleEl = $card.find(".content-title").first();
    const linkEl  = $card.find("a[href]").first();
    const imgEl   = $card.find("img").first();
    const descEl  = $card.find(".content-description").first();
    const dateEl  = $card.find(".content-pub-date").first();

    const title = titleEl.text().trim();
    const href  = linkEl.attr("href");
    if (!title || !href) return;

    const link = href.startsWith("http") ? href : `${baseURL}/${href.replace(/^\//, "")}`;

    const srcset    = imgEl.attr("srcset") || "";
    const thumbnail = srcset
      ? srcset.split(",").map(s => s.trim()).pop().split(" ")[0]
      : (imgEl.attr("src") || "");

    items.push({
      title,
      link,
      thumbnail:   thumbnail || null,
      description: descEl.text().trim(),
      author:      "",
      date:        parseItemDate(dateEl.text().trim()),
    });
  });

  return items;
}

// ===== MAIN =====
async function generateRSS() {
  const feed = new RSS({
    title:       "Science & Nature News",
    description: "Latest news from BBC Sky at Night Magazine, BBC Science Focus, and Discover Wildlife",
    feed_url:    "https://example.com/feeds/feed.xml",
    site_url:    "https://example.com",
    language:    "en",
    pubDate:     new Date().toUTCString(),
    custom_namespaces: {
      media: "http://search.yahoo.com/mrss/",
    },
  });

  let totalItems = 0;

  for (const site of SITES) {
    try {
      const html  = await fetchWithFlareSolverr(site.url);
      const $     = cheerio.load(html);
      const items = parseSite($, site.baseURL);

      console.log(`${site.name}: found ${items.length} articles`);

      items.slice(0, 30).forEach(item => {
        const extra = item.thumbnail
          ? {
              enclosure:       { url: item.thumbnail, type: "image/jpeg", size: 0 },
              custom_elements: [{ "media:content": { _attr: { url: item.thumbnail, medium: "image" } } }],
            }
          : {};

        feed.item({
          title:       item.title,
          url:         item.link,
          description: item.description || "",
          author:      item.author || undefined,
          date:        item.date,
          ...extra,
        });

        totalItems++;
      });

    } catch (err) {
      console.error(`❌ Error scraping ${site.name}: ${err.message}`);
    }
  }

  if (totalItems === 0) {
    feed.item({
      title:       "Feed generation failed",
      url:         "https://example.com",
      description: "An error occurred during scraping.",
      date:        new Date(),
    });
  }

  fs.writeFileSync("./feeds/feed.xml", feed.xml({ indent: true }));
  console.log(`\n✅ RSS generated with ${totalItems} total items → ./feeds/feed.xml`);
}

generateRSS();
