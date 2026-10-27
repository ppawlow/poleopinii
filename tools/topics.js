// tools/topics.js
const mongoose = require("mongoose");

const topicOfTheDaySchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true }, // Wymuszamy unikalność na poziomie bazy
  summary: { type: String, required: true },
  importance: { type: Number, required: true, min: 1, max: 10 },
  sourceUrl: { type: String, default: null },
  fetchedAt: { type: Date, default: Date.now }, // Zmiana nazwy pola dla kompatybilności TTL
});

const TopicOfTheDay = mongoose.model("TopicOfTheDay", topicOfTheDaySchema);

module.exports = { TopicOfTheDay };
