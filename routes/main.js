const express = require("express");
const path = require("path");
const fsPromises = require("fs").promises;

const {
  User,
  // Post,
  createLog,
  createNotification,
  getScopedPosts,
} = require("../tools/db");

const { accessControl } = require("../tools/security");

const { validateId } = require("../tools/validation");

module.exports = express
  .Router()
  // Dostep publiczny
  .get("/", getMain)
  .get("/search", getSearch)
  .get("/search/api", getSearchApi)
  .get("/topics", getTopics)
  .get("/regulamin", getTerms)
  .get("/polityka-prywatnosci",getPrivacy)

  // Dostęp tylko dla zalogowanych
  .use(accessControl)
  .get("/following-feed", getFollowingFeed)
  .get("/events", getEvents)
  .get("/events/api", getEventsApi)
  .post("/follow/:id", validateId("id"), postFollow)
  .post("/block/:id", validateId("id"), postBlock);

/*    Handlers    */

// Strona główna
async function getMain(req, res) {
  try {
    const limit = 10;

    const { posts, totalPosts } = await getScopedPosts(req, {
      scope: "home",
      limit,
    });

    // Pobranie listy obserwowanych tylko dla lewego paska bocznego
    let userFollowingIds = [];

    if (req.dbUser) userFollowingIds = req.dbUser.following || [];

    const followingProfiles = userFollowingIds.length
      ? await User.find({ _id: { $in: userFollowingIds } }).select(
          "name avatarUrl nickname",
        )
      : [];

    const { TopicOfTheDay } = require("../tools/db");
    // 1. Importujemy obiekt AI_CONFIG z pliku konfiguracyjnego
    const { AI_CONFIG } = require("../config");
    const maxTopics = AI_CONFIG.MAX_TOPICS || 5;

    // 2. Podmieniamy sztywną cyfrę 5 na zmienną maxTopics w metodzie .limit()
    // const dailyTopics = await TopicOfTheDay.find({}).sort({ createdAt: -1 }).limit(maxTopics).lean();
    const dailyTopics = await TopicOfTheDay.find({})
      .sort({ importance: -1, fetchedAt: -1 })
      .limit(maxTopics)
      .lean();

    res.render("main", {
      title: "Strona główna",
      posts,
      followingList: userFollowingIds.map((id) => id.toString()),
      followingProfiles,
      dailyTopics,
      hasMore: totalPosts > limit,
      currentTab: "home",
    });
  } catch (err) {
    console.error("Błąd ładowania strony głównej:", err);
    res.status(500).send("Błąd serwera");
  }
}

//Posty obserwujących
async function getFollowingFeed(req, res) {
  try {
    const { posts } = await getScopedPosts(req, {
      scope: "following",
      limit: 50,
    });

    const dbUser = req.dbUser;
    const followingProfiles = await User.find({
      _id: { $in: dbUser.following },
    }).select("displayName avatarUrl");

    res.render("main", {
      title: "Obserwowani",
      posts,
      followingList: dbUser.following.map((id) => id.toString()),
      followingProfiles,
      hasMore: false,
      currentTab: "following",
    });
  } catch (err) {
    console.error("Błąd strumienia obserwowanych:", err);
    res.status(500).send("Błąd strumienia");
  }
}

// Obserwuj
async function postFollow(req, res) {
  try {
    const targetUserId = req.params.id;
    const dbUser = req.dbUser; // Korzystamy bezpośrednio z bezpiecznego req.dbUser!
    const targetUser = await User.findById(targetUserId);

    if (!targetUser || !dbUser)
      return res.status(404).json({ error: "Nie znaleziono użytkownika" });

    // NAPRAWIONO: Korzystamy z metod instancji zamiast wadliwego .includes()
    const iBlockHim = dbUser.isBlocking(targetUser._id);
    const heBlocksMe = targetUser.isBlocking(dbUser._id);

    if (iBlockHim || heBlocksMe)
      return res.status(403).json({ error: "Blokada uniemożliwia operację." });

    const isFollowing = dbUser.isFollowing(targetUser._id);

    if (!isFollowing) {
      dbUser.following.push(targetUser._id);
      await createNotification({
        senderId: dbUser._id,
        recipientId: targetUser._id,
        type: "follow",
      });
    } else {
      dbUser.following.pull(targetUser._id);
    }

    await dbUser.save();
    return res.json({ success: true, isFollowing: !isFollowing });
  } catch (err) {
    return res.status(500).json({ error: "Błąd operacji follow" });
  }
}

// routes/main.js -> funkcja postBlock

async function postBlock(req, res) {
  try {
    const targetUserId = req.params.id;
    const dbUser = req.dbUser; // Korzystamy z bezpiecznego, znormalizowanego req.dbUser z middleware
    const targetUser = await User.findById(targetUserId).select(
      "name email nickname blocks following",
    );

    if (!targetUser || !dbUser)
      return res.status(404).json({ error: "Nie znaleziono użytkownika" });

    // POPRAWKA LOGIKI RELACJI: Używamy .isBlocking() z prototypów zamiast wadliwego JavaScriptowego .includes()
    const isBlocked = dbUser.isBlocking(targetUser._id);

    if (!isBlocked) {
      dbUser.blocks.push(targetUser._id);
      dbUser.following.pull(targetUser._id);
      await createLog(
        req,
        `Zablokowano użytkownika: ${targetUser.displayName}`,
        dbUser.email,
      );
    } else {
      dbUser.blocks.pull(targetUser._id);
      await createLog(
        req,
        `Odblokowano użytkownika: ${targetUser.displayName}`,
        dbUser.email,
      );
    }

    await dbUser.save();

    // ZWRACAMY JSON ZAMIAST REDIRECT
    return res.json({ success: true, isBlocked: !isBlocked });
  } catch (err) {
    console.error("Błąd metody postBlock:", err);
    return res.status(500).json({ error: "Błąd operacji blokowania" });
  }
}

/// Wyszukiwanie tradycyjne (widok) z walidacją serwerową minimum 3 znaków
async function getSearch(req, res) {
  const query = req.query.q;

  try {
    const cleanQuery = query ? query.trim() : "";
    let results = [];

    // Jeśli zapytanie ma mniej niż 3 znaki, renderujemy widok pusty bez odpytywania bazy
    if (cleanQuery.length >= 3) {
      const escapedQuery = cleanQuery.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escapedQuery, "i");
      const searchConditions = { name: searchRegex };

      results = await User.find(searchConditions)
        .select("name avatarUrl bio alias")
        .limit(20)
        .lean();
    }

    res.render("search", {
      title: "Szukaj...",
      results,
      currentTab: "search",
      query: cleanQuery,
    });
  } catch (err) {
    console.error("Błąd bezpiecznego wyszukiwania użytkowników:", err);
    res.status(500).send("Błąd wyszukiwania");
  }
}

// Wyszukiwanie asynchroniczne API z obsługą braku dopasowań oraz błędu HTTP 400
async function getSearchApi(req, res) {
  const query = req.query.q;
  try {
    const cleanQuery = query ? query.trim() : "";

    // Jeśli brak parametru, zwracamy pusty HTML
    if (cleanQuery.length === 0) return res.json({ html: "" });

    // Zabezpieczenie serwerowe: Odrzucenie prób zapytań krótszych niż 3 znaki
    if (cleanQuery.length < 3) {
      return res
        .status(400)
        .send("Fraza wyszukiwania musi składać się z co najmniej 3 znaków.");
    }

    const escapedQuery = cleanQuery.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escapedQuery, "i");
    const searchConditions = { name: searchRegex };

    const rawResults = await User.find(searchConditions)
      .select("name avatarUrl bio alias")
      .limit(20)
      .lean();

    // NOWOŚĆ: Obsługa braku dopasowań dla wyszukiwania asynchronicznego (AJAX)
    if (rawResults.length === 0) {
      const noResultsHtml = `
        <div class="login-prompt" style="text-align: center; padding: 32px; background: #fff; border-radius: 8px; width: 100%;">
          <p style="color: #65676b; font-size: 15px; margin: 0;">Nie znaleziono użytkowników pasujących do kryteriów wyszukiwania dla frazy: "${cleanQuery.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"</p>
        </div>
      `;
      return res.json({ html: noResultsHtml });
    }

    let finalHtml = "";
    for (const doc of rawResults) {
      const mappedUser = {
        _id: doc._id,
        name: doc.name,
        avatarUrl: doc.avatarUrl || "/uploads/default-avatar.png",
        bio:
          doc.bio ||
          "Ten użytkownik nie dodał jeszcze żadnych informacji o sobie.",
        profileUrl: doc.alias ? `/profile/${doc.alias}` : `/profile/${doc._id}`,
      };

      const htmlSnippet = await new Promise((resolve) => {
        req.app.render(
          "partials/search-result-card",
          { resultUser: mappedUser },
          (err, html) => resolve(html || ""),
        );
      });
      finalHtml += htmlSnippet;
    }

    return res.json({ html: finalHtml });
  } catch (err) {
    console.error("Błąd bezpiecznego API wyszukiwania:", err);
    return res.status(500).json({ error: "Błąd wyszukiwania" });
  }
}

async function getEvents(req, res) {
  try {
    const currentUserId = req.dbUser._id;

    // Filtrujemy zdarzenia z ostatnich 7 dni powiązane z zalogowanym użytkownikiem
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { Notification } = require("../tools/db");

    const events = await Notification.aggregate([
      {
        $match: {
          recipientId: currentUserId,
          createdAt: { $gt: sevenDaysAgo },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      // Łączymy z tabelą użytkowników, aby pobrać dane nadawcy (KTO)
      {
        $lookup: {
          from: "users",
          localField: "senderId",
          foreignField: "_id",
          as: "sender",
        },
      },
      { $unwind: "$sender" },
      // Łączymy z tabelą postów, aby pobrać tytuł (Z CZYM)
      {
        $lookup: {
          from: "posts",
          localField: "postId",
          foreignField: "_id",
          as: "post",
        },
      },
      { $unwind: { path: "$post", preserveNullAndEmptyArrays: true } },
    ]);

    // Mapujemy surowe dokumenty do postaci czytelnej dla widoku
    const formattedEvents = events.map((ev) => {
      // Bezpieczne ustalenie nazwy wyświetlanej nadawcy (DRY)
      const senderName =
        ev.sender.nickname && ev.sender.nickname.trim().length > 0
          ? ev.sender.nickname.trim()
          : ev.sender.name;

      return {
        _id: ev._id,
        createdAt: ev.createdAt,
        senderId: ev.senderId,
        senderName: senderName,
        type: ev.type,
        postId: ev.postId,
        postTitle: ev.post ? ev.post.title || "Wpis bez tytułu" : "Twój post",
      };
    });

    res.render("events", {
      title: "Twoje powiadomienia",
      events: formattedEvents,
      currentTab: "events",
    });
  } catch (err) {
    console.error("Błąd ładowania powiadomień osi czasu:", err);
    res.status(500).send("Błąd wczytywania zdarzeń konta.");
  }
}

async function getEventsApi(req, res) {
  try {
    const currentUserId = req.dbUser._id;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { Notification } = require("../tools/db");
    const events = await Notification.aggregate([
      {
        $match: { recipientId: currentUserId, createdAt: { gt: sevenDaysAgo } },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      {
        $lookup: {
          from: "users",
          localField: "senderId",
          foreignField: "_id",
          as: "sender",
        },
      },
      { $unwind: "sender" },
      {
        $lookup: {
          from: "posts",
          localField: "postId",
          foreignField: "_id",
          as: "post",
        },
      },
      { $unwind: { path: "post", preserveNullAndEmptyArrays: true } },
    ]);

    const { urlAliases } = res.locals;
    const formattedEvents = [];

    for (const ev of events) {
      const senderName =
        ev.sender.nickname && ev.sender.nickname.trim().length > 0
          ? ev.sender.nickname.trim()
          : ev.sender.name;
      const senderIdStr = ev.senderId.toString();
      const senderUrl =
        urlAliases && urlAliases[senderIdStr]
          ? `/profile/${urlAliases[senderIdStr]}`
          : `/profile/${senderIdStr}`;

      const evContext = {
        _id: ev._id,
        createdAt: ev.createdAt,
        senderName,
        senderUrl,
        type: ev.type,
        postId: ev.postId,
        commentId: ev.commentId,
        postTitle: ev.post ? ev.post.title || "Wpis bez tytułu" : "Twój post",
      };

      const htmlSnippet = await new Promise((resolve) => {
        req.app.render("partials/event-row", { ev: evContext }, (err, html) =>
          resolve(html || ""),
        );
      });

      formattedEvents.push({ _id: ev._id, html: htmlSnippet });
    }

    return res.json({ success: true, events: formattedEvents });
  } catch (err) {
    console.error("Błąd API powiadomień:", err);
    return res.status(500).json({ error: "Błąd wczytywania zdarzeń." });
  }
}

async function getTopics(req, res) {
  try {
    const { TopicOfTheDay } = require("../tools/db");
    const { AI_CONFIG } = require("../config");
    const maxTopics = AI_CONFIG.MAX_TOPICS || 5;

    // Pobieramy posortowane tematy z bazy danych
    const dailyTopics = await TopicOfTheDay.find({})
      .sort({ importance: -1, fetchedAt: -1 })
      .limit(maxTopics)
      .lean();

    res.render("daily-topics", {
      title: "Przegląd Wydarzeń - Tematy Dnia przez AI",
      dailyTopics: dailyTopics || [],
      currentTab: "topics",
    });
  } catch (err) {
    console.error("Błąd ładowania dedykowanego widoku tematów dnia:", err);
    res.status(500).send("Wewnętrzny błąd serwera.");
  }
}

// Pomocnicza funkcja pobierająca sformatowaną datę modyfikacji pliku widoku
async function getFileModificationDate(viewName) {
  try {
    // Ścieżka do pliku widoku (np. views/terms.pug)
    const filePath = path.join(__dirname, "../views", `${viewName}.pug`);
    const stats = await fsPromises.stat(filePath);
    
    // Formatowanie daty do polskiego standardu: dd miesiąc rrrr
    return stats.mtime.toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (err) {
    console.error(`Błąd odczytu daty pliku ${viewName}:`, err);
    // Zapasowy fallback na wypadek awarii odczytu pliku
    return new Date().toLocaleDateString("pl-PL");
  }
}

async function getTerms(req, res){
    const lastUpdate = await getFileModificationDate("terms");
    res.render("terms", {
      title: "Regulamin platformy",
      lastUpdate // Przekazanie dynamicznej daty do Pug
    });
}

async function getPrivacy(req, res){
    const lastUpdate = await getFileModificationDate("privacy");
    res.render("privacy", {
      title: "Polityka prywatności",
      lastUpdate // Przekazanie dynamicznej daty do Pug
    });
  }
