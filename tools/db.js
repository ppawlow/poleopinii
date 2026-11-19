// tools/db.js
const mongoose = require("mongoose");

const dbModules = Object.assign(
  {},
  require("./user"),
  require("./post"),
  require("./upload"),
  require("./systemLog"),
  require("./notification"),
  require("./topics"),
  require("./settings"),
);

mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/test")
  .then(async () => {
    console.log("Połączono z bazą MongoDB z poziomu zintegrowanego modułu db.js");
    try {
      await dbModules.User.syncIndexes();
      await dbModules.Post.syncIndexes();
      console.log("[MONGODB] Indeksy kolekcji User i Post zsynchronizowane pomyślnie.");
    } catch (idxErr) {
      console.error("[MONGODB BŁĄD INDEKSÓW]: Nie udało się zbudować indeksów unikalnych:", idxErr.message);
    }
  })
  .catch((err) =>
    console.error("Krytyczny błąd połączenia z MongoDB w db.js:", err),
  );

module.exports = dbModules;
