// tools/analytics.js
const mongoose = require("mongoose");
const crypto = require("crypto");
const { createLog } = require("./systemLog");

const WINDOW_MS = 60 * 60 * 1000;      // 1 godzina (okno zliczania 404)
const MAX_404_PER_HOUR = 10;           // limit nieistniejących ścieżek na godzinę
const BAN_DURATION_SEC = 3600;         // czas blokady w bazie (1 godzina)
const CLEAN_CACHE_TTL_MS = 60 * 1000;  // cache czystych IP w RAM na 60 s

// 1. Model statystyk dziennych
const dailyStatsSchema = new mongoose.Schema({
  dateKey: { type: String, required: true, unique: true },
  totalVisits: { type: Number, default: 0 },
  blockedVisits: { type: Number, default: 0 },
  loggedInVisits: { type: Number, default: 0 },
  tokensIn: { type: Number, default: 0 },
  tokensOut: { type: Number, default: 0 },
  tokensTotal: { type: Number, default: 0 },
  uniqueIpHashes: [{ type: String }],
  backfilledFromLogs: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});

const DailyStats = mongoose.model("DailyStats", dailyStatsSchema);

// 2. Model czarnej listy IP z automatycznym wygasaniem po 1h (indeks TTL)
const bannedIpSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true, index: true },
  reason: { type: String, default: "Bot trap (404 flood)" },
  hits: { type: Number, default: 0 },
  lastPaths: [{ type: String }],
  createdAt: { type: Date, default: Date.now, expires: BAN_DURATION_SEC },
});

const BannedIp = mongoose.model("BannedIp", bannedIpSchema);

// 3. Reguły i pamięć podręczna pułapki na boty
const IGNORED_BOT_PATHS = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/.well-known/security.txt",
]);

const INSTANT_BAN_PATTERNS = [
  /\/wp-admin/i,
  /\/wp-login\.php/i,
  /\/wp-content/i,
  /\/wp-includes/i,
  /\/xmlrpc\.php/i,
  /\/wlwmanifest\.xml/i,
  /\/wp-config/i,
  /\/administrator/i,
  /\/joomla/i,
  /\/drupal/i,
  /\/\.env/i,
  /\/\.git/i,
  /\/\.svn/i,
  /\/\.htaccess/i,
  /\/\.htpasswd/i,
  /\/\.aws/i,
  /\/\.ssh/i,
  /\/config\.json/i,
  /\/docker-compose\.yml/i,
  /\/package\.json/i,
  /\.php$/i,
  /\.asp$/i,
  /\.aspx$/i,
  /\/phpmyadmin/i,
  /\/pma/i,
  /\/adminer/i,
  /\/mysql/i,
  /\/cgi-bin/i,
  /\/vendor\/phpunit/i,
  /\/eval-stdin/i,
  /\/shell/i,
  /\/webshell/i,
];

const strikeMap = new Map();
const banCache = new Map();
const cleanCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of strikeMap.entries()) {
    if (now - data.firstHit > WINDOW_MS) strikeMap.delete(ip);
  }
  for (const [ip, exp] of banCache.entries()) {
    if (now > exp) banCache.delete(ip);
  }
  for (const [ip, exp] of cleanCache.entries()) {
    if (now > exp) cleanCache.delete(ip);
  }
}, 15 * 60 * 1000).unref();

function isLocalIp(ip) {
  return !ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isInstantBanPath(reqPath) {
  return INSTANT_BAN_PATTERNS.some((regex) => regex.test(reqPath));
}

/**
 * Sprawdza, czy ścieżka jest znana w zarejestrowanej mapie serwisu (serviceMap)
 */
function isKnownInServiceMap(serviceMap, method, urlPath) {
  if (!serviceMap) return true;
  const methodRoutes = serviceMap[method] || serviceMap.GET || {};
  const cleanSegments = urlPath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  if (cleanSegments.length === 0) return true; // strona główna "/"

  const prefix = cleanSegments[0];
  const subSegments = cleanSegments.slice(1);
  const candidates = methodRoutes[prefix] || methodRoutes[""] || [];

  return candidates.some((routeSegments) => {
    const target = methodRoutes[prefix] ? subSegments : cleanSegments;
    if (routeSegments.length !== target.length) return false;
    return routeSegments.every((seg, idx) => seg.startsWith(":") || seg === target[idx]);
  });
}

async function banIpAddress(ip, req, reason, hits, pathsSample) {
  const now = Date.now();
  cleanCache.delete(ip);
  strikeMap.delete(ip);
  banCache.set(ip, Math.min(now + 15 * 1000, now + BAN_DURATION_SEC * 1000));

  try {
    await BannedIp.findOneAndUpdate(
      { ip },
      {
        ip,
        reason,
        hits,
        lastPaths: pathsSample,
        createdAt: new Date(),
      },
      { upsert: true, new: true },
    );

    await createLog(
      req,
      `[BOT-TRAP] Zablokowano IP ${ip} na 60 min — ${reason} (${pathsSample.slice(0, 5).join(", ")})`,
      "System-Security",
    );
  } catch (err) {
    console.error("[BOT-TRAP SAVE ERROR]:", err.message);
  }
}

function getTodayWarsawKey(dateObj = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dateObj);

  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  return `${map.year}-${map.month}-${map.day}`;
}

function hashVisitorIp(ip, dateKey) {
  const secret = process.env.SESSION_SECRET || "pole-opinii-stats-salt";
  return crypto
    .createHash("sha256")
    .update(`${dateKey}:${secret}:${ip || "127.0.0.1"}`)
    .digest("hex")
    .substring(0, 24);
}

const IGNORED_PATH_PREFIXES = [
  "/css/",
  "/js/",
  "/uploads/",
  "/quill/",
  "/fonts/",
  "/events/api",
  "/verify/status",
  "/posts/load-more",
  "/search/api",
  "/admin/logs/api",
];

const STATIC_EXT_REGEX = /\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|map)$/i;

/**
 * Zunifikowany middleware analityki ruchu oraz ochrony przed botami (Bot Trap + Czarna Lista TTL)
 */
function trafficAnalyticsMiddleware(serviceMap = null) {
  return async (req, res, next) => {
    const urlPath = (req.originalUrl || req.url || "").split("?")[0];
    const ip = req.ip || "127.0.0.1";
    const local = isLocalIp(ip);

    // 1. Weryfikacja czarnej listy IP przed wykonaniem tras (z wyjątkiem localhost)
    if (!local) {
      const now = Date.now();
      const cachedBanExpiry = banCache.get(ip);

      if (cachedBanExpiry && now < cachedBanExpiry) {
        // Zwrócenie 403 wywoła poniższy listener res.on("finish") i podbije blockedVisits
        res.on("finish", () => recordBlockedOnly());
        return res.status(403).send("Access denied.");
      }
      if (cachedBanExpiry) banCache.delete(ip);

      const cachedCleanUntil = cleanCache.get(ip);
      if (!cachedCleanUntil || now >= cachedCleanUntil) {
        try {
          const banned = await BannedIp.findOne({ ip }).lean();
          if (banned) {
            const expiresAt = new Date(banned.createdAt).getTime() + BAN_DURATION_SEC * 1000;
            if (now < expiresAt) {
              banCache.set(ip, Math.min(now + 15 * 1000, expiresAt));
              res.on("finish", () => recordBlockedOnly());
              return res.status(403).send("Access denied.");
            }
          }
          cleanCache.set(ip, now + CLEAN_CACHE_TTL_MS);
        } catch (err) {
          console.error("[BOT-BLOCKER DB ERROR]:", err.message);
        }
      }
    }

    // 2. Rejestracja statystyk i detekcja nieistniejących ścieżek (404 / brak w serviceMap)
    res.on("finish", async () => {
      const status = res.statusCode;
      const isStaticOrInternal =
        STATIC_EXT_REGEX.test(urlPath) ||
        IGNORED_PATH_PREFIXES.some((prefix) => urlPath.startsWith(prefix));

      // Wykrywanie botów na nieobsłużonych ścieżkach (404 oraz brak dopasowania w serviceMap)
      const isNotFound = status === 404 && !isKnownInServiceMap(serviceMap, req.method, urlPath);
      let countedAsBotTrap = false;

      if (isNotFound && !local && !IGNORED_BOT_PATHS.has(urlPath)) {
        countedAsBotTrap = true;

        if (isInstantBanPath(urlPath)) {
          await banIpAddress(ip, req, "Wykryto sygnaturę skanera/bota", 1, [urlPath]);
        } else {
          const now = Date.now();
          let entry = strikeMap.get(ip);
          if (!entry || now - entry.firstHit > WINDOW_MS) {
            entry = { count: 1, firstHit: now, paths: new Set([urlPath]) };
            strikeMap.set(ip, entry);
          } else {
            entry.count += 1;
            if (entry.paths.size < 10) entry.paths.add(urlPath);
            if (entry.count > MAX_404_PER_HOUR) {
              await banIpAddress(
                ip,
                req,
                `Przekroczono limit ${MAX_404_PER_HOUR} nieistniejących ścieżek/h`,
                entry.count,
                Array.from(entry.paths),
              );
            }
          }
        }
      }

      if (isStaticOrInternal && !countedAsBotTrap) return;

      const isBlocked = status === 401 || status === 403 || status === 429 || countedAsBotTrap;
      const isPageVisit = req.method === "GET" && status >= 200 && status < 400;

      if (!isPageVisit && !isBlocked) return;

      const dateKey = getTodayWarsawKey();
      const ipHash = hashVisitorIp(ip, dateKey);
      const isLoggedIn = Boolean(req.dbUser?._id || req.session?.user?.id);

      const incFields = {};
      if (isPageVisit) {
        incFields.totalVisits = 1;
        if (isLoggedIn) incFields.loggedInVisits = 1;
      }
      if (isBlocked) {
        incFields.blockedVisits = 1;
      }

      DailyStats.updateOne(
        { dateKey },
        {
          $inc: incFields,
          ...(isPageVisit ? { $addToSet: { uniqueIpHashes: ipHash } } : {}),
          $set: { updatedAt: new Date() },
        },
        { upsert: true },
      ).catch((err) => {
        console.error("[ANALYTICS ERROR] Błąd zapisu statystyk dziennych:", err.message);
      });
    });

    next();
  };
}

function recordBlockedOnly() {
  const dateKey = getTodayWarsawKey();
  DailyStats.updateOne(
    { dateKey },
    { $inc: { blockedVisits: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true },
  ).catch(() => {});
}

async function getAnalyticsSummary(days = 30) {
  const rawDocs = await DailyStats.find({})
    .sort({ dateKey: -1 })
    .limit(days)
    .lean();

  const dailyRows = rawDocs.map((doc) => {
    const uniqueIps = Array.isArray(doc.uniqueIpHashes)
      ? doc.uniqueIpHashes.length
      : 0;
    const total = doc.totalVisits || 0;
    const loggedIn = doc.loggedInVisits || 0;
    const blocked = doc.blockedVisits || 0;
    const guestVisits = Math.max(0, total - loggedIn);

    return {
      dateKey: doc.dateKey,
      totalVisits: total,
      uniqueIps,
      loggedInVisits: loggedIn,
      guestVisits,
      blockedVisits: blocked,
      tokensIn: doc.tokensIn || 0,
      tokensOut: doc.tokensOut || 0,
      tokensTotal: doc.tokensTotal || 0,
    };
  });

  const todayKey = getTodayWarsawKey();
  const todayStats = dailyRows.find((r) => r.dateKey === todayKey) || {
    dateKey: todayKey,
    totalVisits: 0,
    uniqueIps: 0,
    loggedInVisits: 0,
    guestVisits: 0,
    blockedVisits: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensTotal: 0,
  };

  const totals = dailyRows.reduce(
    (acc, r) => {
      acc.totalVisits += r.totalVisits;
      acc.uniqueIps += r.uniqueIps;
      acc.loggedInVisits += r.loggedInVisits;
      acc.blockedVisits += r.blockedVisits;
      acc.tokensIn += r.tokensIn;
      acc.tokensOut += r.tokensOut;
      acc.tokensTotal += r.tokensTotal;
      return acc;
    },
    {
      totalVisits: 0,
      uniqueIps: 0,
      loggedInVisits: 0,
      blockedVisits: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensTotal: 0,
    },
  );

  return {
    todayStats,
    totals,
    dailyRows,
  };
}

async function backfillDailyStatsFromLogs() {
  try {
    const SystemLog = mongoose.model("SystemLog");
    const logs = await SystemLog.find({})
      .select("userId action ipAddress createdAt")
      .lean();

    if (!logs || logs.length === 0) return 0;

    // Dni, które mają już pełne statystyki (zarówno odwiedziny, jak i niezerowe tokeny)
    const fullyMigratedDocs = await DailyStats.find({
      backfilledFromLogs: true,
    })
      .select("dateKey tokensTotal -_id")
      .lean();

    const visitsMigratedKeys = new Set(fullyMigratedDocs.map((d) => d.dateKey));
    const tokensMigratedKeys = new Set(
      fullyMigratedDocs.filter((d) => (d.tokensTotal || 0) > 0).map((d) => d.dateKey),
    );

    const buckets = new Map();

    for (const log of logs) {
      if (!log.createdAt) continue;
      const dateKey = getTodayWarsawKey(new Date(log.createdAt));

      const needVisits = !visitsMigratedKeys.has(dateKey);
      const needTokens = !tokensMigratedKeys.has(dateKey);
      if (!needVisits && !needTokens) continue;

      if (!buckets.has(dateKey)) {
        buckets.set(dateKey, {
          needVisits,
          needTokens,
          totalVisits: 0,
          blockedVisits: 0,
          loggedInVisits: 0,
          tokensIn: 0,
          tokensOut: 0,
          tokensTotal: 0,
          ipHashes: new Set(),
        });
      }

      const dayStat = buckets.get(dateKey);
      const actionStr = log.action || "";

      // 1. Wyciąganie tokenów z logów CRON AI (In / Out / Total)
      const cronTokensMatch = actionStr.match(
        /Zużycie tokenów -> In:\s*(\d+)\s*\|\s*Out:\s*(\d+)\s*\|\s*Total:\s*(\d+)/i,
      );
      if (cronTokensMatch) {
        if (dayStat.needTokens) {
          dayStat.tokensIn += parseInt(cronTokensMatch[1], 10) || 0;
          dayStat.tokensOut += parseInt(cronTokensMatch[2], 10) || 0;
          dayStat.tokensTotal += parseInt(cronTokensMatch[3], 10) || 0;
        }
        continue;
      }

      // 2. Wyciąganie łącznych tokenów ze starszych logów walidatora postów
      const validatorTokensMatch = actionStr.match(/Zużycie tokenów:\s*(\d+)/i);
      if (validatorTokensMatch && dayStat.needTokens) {
        dayStat.tokensTotal += parseInt(validatorTokensMatch[1], 10) || 0;
      }

      if (dayStat.needVisits) {
        const isBlocked =
          actionStr.includes("[ODRZUCONO") ||
          actionStr.includes("[reCAPTCHA BLOKADA]");

        if (isBlocked) {
          dayStat.blockedVisits += 1;
        } else {
          dayStat.totalVisits += 1;
          if (log.userId) {
            dayStat.loggedInVisits += 1;
          }
          if (log.ipAddress) {
            dayStat.ipHashes.add(hashVisitorIp(log.ipAddress.trim(), dateKey));
          }
        }
      }
    }

    if (buckets.size === 0) return 0;

    let migratedDaysCount = 0;

    for (const [dateKey, stats] of buckets.entries()) {
      const incFields = {};
      if (stats.needVisits) {
        incFields.totalVisits = stats.totalVisits;
        incFields.blockedVisits = stats.blockedVisits;
        incFields.loggedInVisits = stats.loggedInVisits;
      }
      if (stats.needTokens && stats.tokensTotal > 0) {
        incFields.tokensIn = stats.tokensIn;
        incFields.tokensOut = stats.tokensOut;
        incFields.tokensTotal = stats.tokensTotal;
      }

      if (Object.keys(incFields).length === 0) continue;

      const updateQuery = {
        $inc: incFields,
        $set: {
          backfilledFromLogs: true,
          updatedAt: new Date(),
        },
      };

      if (stats.needVisits && stats.ipHashes.size > 0) {
        updateQuery.$addToSet = {
          uniqueIpHashes: { $each: Array.from(stats.ipHashes) },
        };
      }

      const updateResult = await DailyStats.updateOne({ dateKey }, updateQuery, {
        upsert: true,
      });

      if (updateResult.upsertedCount > 0 || updateResult.modifiedCount > 0) {
        migratedDaysCount += 1;
      }
    }

    if (migratedDaysCount > 0) {
      console.log(
        `[ANALYTICS MIGRATION] Zaktualizowano statystyki i tokeny AI dla ${migratedDaysCount} dni z SystemLog.`,
      );
    }

    return migratedDaysCount;
  } catch (err) {
    console.error("[ANALYTICS MIGRATION ERROR]:", err.message);
    return 0;
  }
}

async function recordAiTokens({ input = 0, output = 0, total = 0 } = {}) {
  const inVal = Number(input) || 0;
  const outVal = Number(output) || 0;
  const totVal = Number(total) || inVal + outVal;
  if (inVal === 0 && outVal === 0 && totVal === 0) return;

  const dateKey = getTodayWarsawKey();
  try {
    await DailyStats.updateOne(
      { dateKey },
      {
        $inc: {
          tokensIn: inVal,
          tokensOut: outVal,
          tokensTotal: totVal,
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error("[ANALYTICS TOKENS ERROR]:", err.message);
  }
}

function unbanIpFromCache(ip) {
  if (!ip) return;
  banCache.delete(ip);
  strikeMap.delete(ip);
  cleanCache.set(ip, Date.now() + CLEAN_CACHE_TTL_MS);
}
module.exports = {
  DailyStats,
  trafficAnalyticsMiddleware,
  getAnalyticsSummary,
  getTodayWarsawKey,
  backfillDailyStatsFromLogs,
  recordAiTokens,
  BannedIp,
  unbanIpFromCache,
};
