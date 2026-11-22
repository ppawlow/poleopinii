// tools/analytics.js
const mongoose = require("mongoose");
const crypto = require("crypto");

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

    const alreadyMigratedKeys = new Set(
      (
        await DailyStats.find({ backfilledFromLogs: true })
          .select("dateKey -_id")
          .lean()
      ).map((d) => d.dateKey),
    );

    const buckets = new Map();

    for (const log of logs) {
      if (!log.createdAt) continue;
      const dateKey = getTodayWarsawKey(new Date(log.createdAt));
      if (alreadyMigratedKeys.has(dateKey)) continue;

      if (!buckets.has(dateKey)) {
        buckets.set(dateKey, {
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

      const cronTokensMatch = actionStr.match(
        /Zużycie tokenów -> In:\s*(\d+)\s*\|\s*Out:\s*(\d+)\s*\|\s*Total:\s*(\d+)/i,
      );
      if (cronTokensMatch) {
        dayStat.tokensIn += parseInt(cronTokensMatch[1], 10) || 0;
        dayStat.tokensOut += parseInt(cronTokensMatch[2], 10) || 0;
        dayStat.tokensTotal += parseInt(cronTokensMatch[3], 10) || 0;
        continue;
      }

      const validatorTokensMatch = actionStr.match(/Zużycie tokenów:\s*(\d+)/i);
      if (validatorTokensMatch) {
        dayStat.tokensTotal += parseInt(validatorTokensMatch[1], 10) || 0;
      }

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

    if (buckets.size === 0) return 0;

    let migratedDaysCount = 0;

    for (const [dateKey, stats] of buckets.entries()) {
      const updateResult = await DailyStats.updateOne(
        { dateKey, backfilledFromLogs: { $ne: true } },
        {
          $inc: {
            totalVisits: stats.totalVisits,
            blockedVisits: stats.blockedVisits,
            loggedInVisits: stats.loggedInVisits,
            tokensIn: stats.tokensIn,
            tokensOut: stats.tokensOut,
            tokensTotal: stats.tokensTotal,
          },
          $addToSet: {
            uniqueIpHashes: { $each: Array.from(stats.ipHashes) },
          },
          $set: {
            backfilledFromLogs: true,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      if (updateResult.upsertedCount > 0 || updateResult.modifiedCount > 0) {
        migratedDaysCount += 1;
      }
    }

    if (migratedDaysCount > 0) {
      console.log(
        `[ANALYTICS MIGRATION] Zaimportowano historyczne statystyki (w tym dzisiejsze) dla ${migratedDaysCount} dni z SystemLog.`,
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

module.exports = {
  DailyStats,
  trafficAnalyticsMiddleware,
  getAnalyticsSummary,
  getTodayWarsawKey,
  backfillDailyStatsFromLogs,
  recordAiTokens,
};
