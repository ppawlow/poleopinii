// tools/systemLog.js
const mongoose = require("mongoose");

const logSchema = new mongoose.Schema({
  email: { type: String, default: "Gość" },
  action: { type: String, required: true },
  ipAddress: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const SystemLog = mongoose.model("SystemLog", logSchema);

async function createLog(req, actionText, explicitEmail = null) {
  try {
    const ip = req.ip || "127.0.0.1";
    const userEmail =
      explicitEmail || (req.session?.user ? req.session.user.email : "Gość");
    await SystemLog.create({
      email: userEmail,
      action: actionText,
      ipAddress: ip,
    });
  } catch (err) {
    console.error("Błąd zapisywania logu:", err);
  }
}

module.exports = { SystemLog, createLog };
