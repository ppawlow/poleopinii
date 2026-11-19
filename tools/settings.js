// tools/settings.js
const mongoose = require("mongoose");
const { SERVICE_SOCIALS } = require("../config");

const systemSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});

const SystemSetting = mongoose.model("SystemSetting", systemSettingSchema);

/**
 * Zwraca mapę aktywnych serwisów społecznościowych na podstawie SERVICE_SOCIALS z config.js.
 * Domyślnie (jeśli brak wpisu w bazie) wszystkie serwisy z config.js są włączone (true).
 */
async function getSocialShareSettings() {
  const doc = await SystemSetting.findOne({ key: "social_auto_share" }).lean();
  const savedMap = doc?.value || {};

  const result = {};
  for (const social of SERVICE_SOCIALS) {
    result[social.id] =
      typeof savedMap[social.id] === "boolean" ? savedMap[social.id] : true;
  }
  return result;
}

/**
 * Aktualizuje status pojedynczego serwisu społecznościowego.
 */
async function updateSocialShareSetting(platformId, isEnabled) {
  const validIds = SERVICE_SOCIALS.map((s) => s.id);
  if (!validIds.includes(platformId)) {
    throw new Error("Nieznany identyfikator platformy społecznościowej.");
  }

  const current = await getSocialShareSettings();
  current[platformId] = Boolean(isEnabled);

  await SystemSetting.findOneAndUpdate(
    { key: "social_auto_share" },
    { $set: { value: current, updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  return current;
}

module.exports = {
  SystemSetting,
  getSocialShareSettings,
  updateSocialShareSetting,
};
