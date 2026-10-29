// tools/systemLog.js
const mongoose = require("mongoose");

const logSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  fallbackName: { type: String, default: "Gość" },
  action: { type: String, required: true },
  ipAddress: { type: String, required: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 30 * 24 * 60 * 60, // Automatyczne usuwanie po 30 dniach
  },
});

const SystemLog = mongoose.model("SystemLog", logSchema);

async function createLog(req, actionText, explicitIdentifier = null) {
  try {
    const ip = req.ip || "127.0.0.1";
    let activeUserId = null;
    let fallback = "Gość";

    if (req.dbUser?.id || req.dbUser?._id) {
      activeUserId = req.dbUser._id;
    } else if (req.session?.user?.id) {
      activeUserId = req.session.user.id;
    }

    // Jeśli przekazano jawny identyfikator tekstowy (np. "System-AI")
    if (explicitIdentifier) {
      fallback = explicitIdentifier;
    }

    console.log(`[AUDYT] [IP: ${ip}] Akcja: ${actionText}`);

    await SystemLog.create({
      userId: activeUserId,
      fallbackName: activeUserId ? "Zalogowany" : fallback,
      action: actionText,
      ipAddress: ip,
    });
  } catch (err) {
    console.error("Błąd zapisywania logu systemowego:", err);
  }
}

module.exports = { SystemLog, createLog };
