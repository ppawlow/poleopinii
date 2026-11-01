// routes/editorsRoom.js
const express = require("express");
const { User, getScopedPosts, TopicOfTheDay } = require("../tools/db");
const { accessControl } = require("../tools/security");
const { AI_CONFIG } = require("../config");

const router = express.Router();

// Middleware sprawdzający uprawnienia redaktora przed wejściem na trasę
router.use(accessControl, (req, res, next) => {
  if (req.dbUser && req.dbUser.role === "editor") {
    return next();
  }
  return res.status(403).send("Brak uprawnień: Ta sekcja jest dostępna wyłącznie dla zweryfikowanych Redaktorów Serwisu.");
});

router.get("/", async (req, res) => {
  try {
    const limit = 20;

    // 1. Pobieramy posty przeznaczone wyłącznie dla pokoju redaktorów
    const { posts, totalPosts } = await getScopedPosts(req, {
      scope: "editors",
      limit,
    });

    // 2. Pobieramy pełną listę redaktorów dla lewego paska bocznego
    const editorsList = await User.find({ role: "editor" })
      .select("name avatarUrl nickname alias")
      .sort({ name: 1 })
      .lean();

    // 3. Pobieramy tematy dnia AI dla prawego paska bocznego
    const maxTopics = AI_CONFIG.MAX_TOPICS || 5;
    const dailyTopics = await TopicOfTheDay.find({})
      .sort({ importance: -1, fetchedAt: -1 })
      .limit(maxTopics)
      .lean();

    res.render("editors", {
      title: "Kolegium Redakcyjne (Wewnętrzne)",
      posts,
      editorsList,
      dailyTopics,
      hasMore: totalPosts > limit,
      currentTab: "editors",
      // Wstrzykujemy domyślny zakres widoczności dla formularza create-post w tym widoku
      defaultVisibility: "editors" 
    });
  } catch (err) {
    console.error("Błąd ładowania pokoju redakcyjnego:", err);
    res.status(500).send("Wewnętrzny błąd serwera");
  }
});

module.exports = router;
