// tools/db.js
const mongoose = require("mongoose");

// =========================================================================
// INICJALIZACJA POŁĄCZENIA Z BAZĄ DANYCH MONGODB
// =========================================================================
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/test")
  .then(() =>
    console.log(
      "Połączono z bazą MongoDB z poziomu zintegrowanego modułu db.js",
    ),
  )
  .catch((err) =>
    console.error("Krytyczny błąd połączenia z MongoDB w db.js:", err),
  );

// =========================================================================
// AGREGACJA ROZPROSZONYCH MODUŁÓW DOMENOWYCH
// =========================================================================

module.exports = Object.assign(
  require("./user"),
  require("./post"),
  require("./upload"),
  require("./systemLog"),
  require("./notification"),
  require("./topics"),
);
