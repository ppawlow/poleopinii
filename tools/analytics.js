// tools/analytics.js
const mongoose = require("mongoose");
const crypto = require("crypto");

const dailyStatsSchema = new mongoose.Schema({
  dateKey: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD (Europe/Warsaw)
  totalVisits: { type: Number, default: 0 },               // Łączna liczba odsłon stron
  blockedVisits: { type: Number, default: 0 },             // Odrzucone przez system (401/403/429)
  loggedInVisits: { type: Number, default: 0 },            // Odsłony wykonane przez zalogowanych użytkowników
  uniqueIpHashes: [{ type: String }],                      // Zbiór unikalnych skrótów IP w danym dniu
  updatedAt: { type: Date, default: Date.now },
});

const DailyStats = mongoose.model("DailyStats", dailyStatsSchema);

// Zwraca klucz bieżącego dnia w polskiej strefie czasowej: YYYY-MM-DD
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

// Jednokierunkowy skrót IP (RODO-compliant, solony kluczem dnia i sekretem sesji)
function hashVisitorIp(ip, dateKey) {
  const secret = process.env.SESSION_SECRET || "pole-opinii-stats-salt";
  return crypto
    .createHash("sha256")
    .update(`${dateKey}:${secret}:${ip || "127.0.0.1"}`)
    .digest("hex")
    .substring(0, 24);
}

// Ścieżki techniczne/pollingowe pomijane w statystykach odwiedzin
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
 * Middleware rejestrujący statystyki dzienne po zakończeniu odpowiedzi HTTP (res.on('finish'))
 */
function trafficAnalyticsMiddleware(req, res, next) {
  const urlPath = (req.originalUrl || req.url || "").split("?")[0];

  if (
    STATIC_EXT_REGEX.test(urlPath) ||
    IGNORED_PATH_PREFIXES.some((prefix) => urlPath.startsWith(prefix))
  ) {
    return next();
  }

  res.on("finish", () => {
    const status = res.statusCode;
    const isBlocked = status === 401 || status === 403 || status === 429;
    const isPageVisit = req.method === "GET" && status >= 200 && status < 400;

    // Rejestrujemy tylko realne odsłony stron (GET 2xx/3xx) lub zdarzenia zablokowane przez ochronę
    if (!isPageVisit && !isBlocked) return;

    const dateKey = getTodayWarsawKey();
    const ipHash = hashVisitorIp(req.ip, dateKey);
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
}

/**
 * Pobiera zagregowane statystyki z ostatnich N dni (domyślnie 30 dni) dla Panelu Administratora
 */
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
    };
  });

  // Podsumowanie łączne dla całego okresu oraz dla dzisiejszego dnia
  const todayKey = getTodayWarsawKey();
  const todayStats = dailyRows.find((r) => r.dateKey === todayKey) || {
    dateKey: todayKey,
    totalVisits: 0,
    uniqueIps: 0,
    loggedInVisits: 0,
    guestVisits: 0,
    blockedVisits: 0,
  };

  const totals = dailyRows.reduce(
    (acc, r) => {
      acc.totalVisits += r.totalVisits;
      acc.uniqueIps += r.uniqueIps;
      acc.loggedInVisits += r.loggedInVisits;
      acc.blockedVisits += r.blockedVisits;
      return acc;
    },
    { totalVisits: 0, uniqueIps: 0, loggedInVisits: 0, blockedVisits: 0 },
  );

  return {
    todayStats,
    totals,
    dailyRows, // posortowane od najnowszego dnia
  };
}

module.exports = {
  DailyStats,
  trafficAnalyticsMiddleware,
  getAnalyticsSummary,
  getTodayWarsawKey,
};
