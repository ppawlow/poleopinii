const express = require("express");
const path = require("path");
const fsPromises = require("fs").promises;
const bcrypt = require("bcrypt");
const mailer = require("../tools/mailer");
const { ObjectId } = require("mongodb");

const {
  DEFAULT_ASSETS,
  SERVICE_NAME,
  AUTHOR_RANKS,
  isDevelopment,
} = require("../config");

const {
  User,
  aliasExists,
  upload,
  getScopedPosts,
  countAuthorPublicLikes,
  canonicalizeEmail,
  createLog,
  userExists,
} = require("../tools/db");

const {
  accessControl,
  hasPermission,
  safeUser,
  appendUserData,
  getProfile,
  isLoggedIn,
} = require("../tools/security");

const {
  settingsValidationRules,
  handleRedirectValidationErrors,
  validateFileSignatures,
} = require("../tools/validation");

const photoUpload = upload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "cover", maxCount: 1 },
]);

const ALLOWED_UPLOAD_DIR = path.resolve(__dirname, DEFAULT_ASSETS.uploads);

module.exports = express
  .Router()
  .get("/settings", accessControl, getSettings)
  .get("/:id", getId)

  // Dostęp dla zalogowanych
  .use(accessControl)
  .get("/settings/export-data", getExportData)
  .post("/settings/request-delete", postRequestDeleteAccount) // Krok 1: Generowanie tokenu i wysyłka maila
  .get("/settings/confirm-delete/:token", getConfirmDeleteAccount) // Krok 2: Finalne usunięcie po kliknięciu w link

  .post(
    "/settings",
    settingsValidationRules,
    handleRedirectValidationErrors("/profile/settings"),
    postSettings,
  )
  .post("/update-photos", photoUpload, validateFileSignatures, postUpdatePhotos)
  .post("/update-bio", postUpdateBio)
  .post("/send-private-email", postSendPrivateEmail);

// USTAWIENIA - WIDOK
// routes/profile.js -> funkcja getSettings

// USTAWIENIA - WIDOK
async function getSettings(req, res) {
  // Uzupełniamy dane, których nie ma w domyślnej wersji locals.user
  // Pobieramy name, email ORAZ alias bezpośrednio z kolekcji User
  await appendUserData(res.locals.user, "name email alias");

  // KRYTYCZNA POPRAWKA: Alias pobieramy bezpośrednio z zalogowanego użytkownika,
  // całkowicie eliminując odwołanie do skasowanej kolekcji Alias!
  const currentAlias = req.dbUser.alias || "";

  // Sanityzacja i mapowanie parametrów query w kontrolerze
  const errorKey = req.query.error;
  const allowedErrors = [
    "password_required",
    "exists",
    "invalid_password",
    "server",
  ];
  const safeError = allowedErrors.includes(errorKey) ? errorKey : null;

  res.render("settings", {
    title: "Ustawienia konta",
    currentAlias, // Przekazujemy aktualny alias do pola formularza w Pug
    error: safeError,
    msg:
      req.query.msg === "updated" || req.query.msg === "email_pending"
        ? req.query.msg
        : null,
    customMsg: req.query.customMsg
      ? String(req.query.customMsg).replace(/<\/?[^>]+(>|$)/g, "")
      : null, // Proste oczyszczenie tagów HTML
  });
}

// USTAWIENIA - ZAPIS
async function postSettings(req, res) {
  const dbUser = req.dbUser;
  if (!dbUser) return res.status(401).json({ error: "Brak autoryzacji." });

  const { name, alias, email, bio, currentPassword, allowPrivateEmails } =
    req.body;

  try {
    const targetNormalizedEmail = canonicalizeEmail(email);
    const isEmailChanging = targetNormalizedEmail !== dbUser.normalizedEmail;

    if (isEmailChanging) {
      if (!currentPassword || currentPassword.trim().length === 0) {
        return res.status(400).json({ error: "password_required" });
      }
      const isPasswordValid = await bcrypt.compare(
        currentPassword,
        dbUser.password,
      );
      if (!isPasswordValid) {
        return res.status(400).json({ error: "invalid_password" });
      }
      if (await userExists(email)) {
        return res.status(400).json({ error: "exists" });
      }
    }

    if (isEmailChanging) {
      dbUser.newEmailPending = email.trim();
      dbUser.token = 24;
      await mailer.sendVerificationEmail(dbUser, req);
    }

    // Obsługa aliasu URL profilu - bezpośrednio na dokumencie dbUser
    if (typeof alias !== "undefined") {
      const cleanAlias = alias.trim().toLowerCase();
      if (cleanAlias.length > 0) {
        // Korzystamy z nowego helpera ze sprawdzaniem wykluczenia własnego ID (dbUser._id)
        const { aliasExists } = require("../tools/db");
        if (await aliasExists(cleanAlias, dbUser._id)) {
          return res
            .status(400)
            .json({ error: "Ten alias jest niedozwolony lub zajęty." });
        }
        dbUser.alias = cleanAlias; // Zapisujemy bezpośrednio w obiekcie User
      } else {
        dbUser.alias = undefined; // Usunięcie aliasu
      }
    }

    dbUser.allowPrivateEmails =
      allowPrivateEmails === "on" || allowPrivateEmails === true;
    if (name && name.trim().length > 0) dbUser.name = name.trim();
    if (typeof bio !== "undefined") dbUser.bio = bio;

    await dbUser.save();

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    return res.json({
      success: true,
      msg: isEmailChanging ? "email_pending" : "updated",
      allowPrivateEmails: dbUser.allowPrivateEmails,
      displayName: dbUser.name,
      alias: dbUser.alias || "",
    });
  } catch (err) {
    console.error("Krytyczny błąd zapisu konta:", err);
    return res.status(500).json({ error: "Wystąpił wewnętrzny błąd serwera." });
  }
}

// ==========================================
// ZMIANA ZDJĘĆ PROFILOWYCH
// ==========================================
async function postUpdatePhotos(req, res) {
  try {
    const dbUser = req.dbUser;

    const safeDeleteFile = async (relativeUrl, defaultFileName) => {
      if (!relativeUrl || relativeUrl.includes(defaultFileName)) return;
      const fileName = path.basename(relativeUrl);
      const targetPath = path.resolve(ALLOWED_UPLOAD_DIR, fileName);

      if (targetPath.startsWith(ALLOWED_UPLOAD_DIR)) {
        try {
          await fsPromises.unlink(targetPath);
        } catch (e) {
          if (e.code !== "ENOENT") {
            console.error("Błąd usuwania pliku profilowego:", e);
          }
        }
      }
    };

    // Obsługa awatara
    if (req.files && req.files["avatar"] && req.files["avatar"][0]) {
      const avatarFile = req.files["avatar"][0];
      await safeDeleteFile(dbUser.avatarUrl, DEFAULT_ASSETS.avatar); // DODANO: await

      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const finalName =
        "avatar-" +
        uniqueSuffix +
        path.extname(avatarFile.originalname).toLowerCase();

      await fsPromises.writeFile(
        path.join(ALLOWED_UPLOAD_DIR, finalName),
        avatarFile.buffer,
      );
      dbUser.avatarUrl = "/uploads/" + finalName;
    }

    // Obsługa zdjęcia w tle (cover)
    if (req.files && req.files["cover"] && req.files["cover"][0]) {
      const coverFile = req.files["cover"][0];
      await safeDeleteFile(dbUser.coverUrl, DEFAULT_ASSETS.cover); // DODANO: await

      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const finalName =
        "cover-" +
        uniqueSuffix +
        path.extname(coverFile.originalname).toLowerCase();

      // POPRAWIONO: fs.writeFileSync zmienione na bezpieczne fsPromises.writeFile
      await fsPromises.writeFile(
        path.join(ALLOWED_UPLOAD_DIR, finalName),
        coverFile.buffer,
      );
      dbUser.coverUrl = "/uploads/" + finalName;
    }

    await dbUser.save();

    if (
      req.xhr ||
      req.headers.accept?.includes("json") ||
      req.headers["x-requested-with"] === "XMLHttpRequest" ||
      true
    ) {
      return res.sendStatus(200);
    }

    res.redirect(`/profile/${dbUser._id}`);
  } catch (err) {
    console.error("Błąd przetwarzania zdjęć profilu:", err);
    res.status(500).send("Błąd przetwarzania zdjęć profilu");
  }
}

// AKTUALIZACJA BIO
async function postUpdateBio(req, res) {
  try {
    const dbUser = req.dbUser;
    dbUser.bio = req.body.bio;
    await dbUser.save();

    // ZMIANA: Zwracamy czysty JSON z nową treścią zamiast res.redirect
    return res.json({
      success: true,
      bio: dbUser.bio,
    });
  } catch (err) {
    console.error("Błąd podczas szybkiej aktualizacji bio:", err);
    return res
      .status(500)
      .json({ error: "Wystąpił błąd serwera podczas zapisu biogramu." });
  }
}

// OŚ CZASU PROFILU
async function getId(req, res) {
  try {
    let targetUserId = req.params.id;

    if (!ObjectId.isValid(targetUserId)) {
      // Szukamy dokumentu użytkownika bezpośrednio po jego własnym polu alias
      const foundUserByAlias = await User.findOne({
        alias: targetUserId.toLowerCase(),
      });
      if (!foundUserByAlias)
        return res.status(404).send("Nie znaleziono użytkownika");
      targetUserId = foundUserByAlias._id;
    }

    const targetUser = await getProfile(targetUserId);
    if (!targetUser) return res.status(404).send("Nie znaleziono użytkownika");

    const totalPublicLikes = await countAuthorPublicLikes(targetUser._id);

    const currentRank =
      AUTHOR_RANKS.find((rank) => totalPublicLikes >= rank.minLikes) ||
      AUTHOR_RANKS[AUTHOR_RANKS.length - 1];

    const { posts } = await getScopedPosts(req, {
      scope: "profile",
      targetUserId: targetUser._id,
      limit: 100,
    });

    // 3. Pobranie danych sesyjnych aktywnego (zalogowanego) użytkownika
    let followingList = [];
    let userBlocks = [];
    const dbUser = req.dbUser;
    if (dbUser) {
      followingList = (dbUser.following || []).map((id) => id.toString());
      userBlocks = (dbUser.blocks || []).map((id) => id.toString());
    }

    const targetFollowingIds = targetUser.following || [];
    const followingFilter = { _id: { $in: targetFollowingIds } };

    // Odfiltrowanie osób, które zablokowały właściciela profilu
    const usersWhoBlockedTarget = await User.find({
      blocks: targetUser._id,
    }).select("_id");

    const targetBlockersIds = usersWhoBlockedTarget.map((u) => u._id);
    if (targetBlockersIds.length > 0) {
      followingFilter._id = {
        $in: targetFollowingIds,
        $nin: targetBlockersIds,
      };
    }
    const followingProfiles = await User.find(followingFilter).select(
      "name avatarUrl nickname",
    );

    // 5. BEZPIECZNE POBIERANIE OBSERWUJĄCYCH
    const followersFilter = { following: targetUser._id };
    const targetBlocksList = targetUser.blocks || [];
    if (targetBlocksList.length > 0) {
      followersFilter._id = { $nin: targetBlocksList };
    }
    const followersCount = await User.countDocuments(followersFilter);
    const followersProfiles = await User.find(followersFilter).select(
      "name avatarUrl nickname",
    );

    // 6. BEZPIECZNE POBIERANIE ZABLOKOWANYCH (Pobieramy listę zablokowanych TYLKO dla profilu docelowego)
    const blockedProfiles = await User.find({
      _id: { $in: targetBlocksList },
    }).select("name avatarUrl nickname");

    // 7. Renderowanie z jawnym przekazaniem czystych struktur danych do Pug
    res.render("profile", {
      title: `Profil ${targetUser.nickname || targetUser.name}`,
      profileUser: targetUser,
      totalPublicLikes: totalPublicLikes,
      currentRank,
      posts,
      followingList,
      userBlocks,
      blockedProfiles,
      followersCount,
      followingProfiles,
      followersProfiles,
      currentTab: req.session?.user?.id === targetUser.id ? "profile" : "none",
    });
  } catch (err) {
    console.error("Błąd krytyczny wczytywania profilu:", err);
    res.status(500).send("Błąd wczytywania profilu");
  }
}

async function postSendPrivateEmail(req, res) {
  const { targetUserId, subject, message } = req.body;
  try {
    if (!ObjectId.isValid(targetUserId)) {
      return res.status(400).send("Nieprawidłowy ID adresata.");
    }

    const sender = req.dbUser;
    const recipient = await User.findById(targetUserId);

    if (!recipient) return res.status(404).send("Nie odnaleziono adresata.");

    // Weryfikacja uprawnień i wzajemnych blokad za pomocą centralnego silnika
    if (!hasPermission(sender, "user", "canSendMail", recipient)) {
      return res
        .status(403)
        .send(
          "Operacja zablokowana: Brak pełnej weryfikacji tożsamości lub aktywna blokada profilu.",
        );
    }

    if (!sender.allowPrivateEmails || !recipient.allowPrivateEmails) {
      return res
        .status(403)
        .send(
          "Brak zgody na prywatną komunikację e-mail (Funkcja zablokowana).",
        );
    }

    await mailer.sendPrivatePeerEmail(sender, recipient, subject, message, req);

    await createLog(
      req,
      `Wysłano prywatną wiadomość e-mail do użytkownika o ID: ${recipient._id}`,
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error("Krytyczny błąd metody postSendPrivateEmail:", err);
    return res.status(500).send("Wewnętrzny błąd serwera pocztowego.");
  }
}

// RODO: Eksport wszystkich danych użytkownika do pliku JSON
async function getExportData(req, res) {
  try {
    const dbUser = await User.findById(req.dbUser._id)
      .select("+password +securityToken +verificationBankAccount")
      .lean();

    if (!dbUser) return res.status(404).send("Nie odnaleziono użytkownika.");

    // Pobieramy aktywność powiązaną z użytkownikiem z innych kolekcji
    // const { TopicOfTheDay } = require("../tools/db"); // Aby uniknąć cyklicznych zależności
    const userPosts = await getScopedPosts(req, {
      scope: "profile",
      targetUserId: dbUser._id,
      limit: 1000,
    });

    // Budujemy kompletny pakiet danych RODO
    const dataPackage = {
      generowano: new Date().toISOString(),
      podmiot_odpowiedzialny: "Kooperatywa Pracy Organicznej",
      profil_uzytkownika: {
        id: dbUser._id,
        nazwa_wyswietlana: dbUser.name,
        email: dbUser.email,
        znormalizowany_email: dbUser.normalizedEmail,
        status_weryfikacji: dbUser.isVerified,
        status_przelewu: dbUser.verificationTransferStatus,
        kod_przelewu: dbUser.verificationTransferCode,
        skrot_konta_bankowego_sha256: dbUser.verificationBankAccount,
        biogram: dbUser.bio,
        zgoda_wiadomosci_prywatne: dbUser.allowPrivateEmails,
        licznik_blokad_bezpieczenstwa_ai: dbUser.aiBlockedSafetyCount,
        licznik_blokad_faktograficznych_ai: dbUser.aiBlockedFactCheckCount,
        obserwowani_identyfikatory: dbUser.following || [],
        zablokowani_identyfikatory: dbUser.blocks || [],
      },
      twoje_artykuly: (userPosts.posts || []).map((p) => ({
        id: p._id,
        tytul: p.title,
        tresc_czysta: p.content ? p.content.replace(/<\/?[^>]+(>|$)/g, "") : "",
        widocznosc: p.visibility,
        data_utworzenia: p.createdAt,
        polubienia_liczba: p.likesCount,
        komentarze: (p.comments || []).map((c) => ({
          tresc: c.content,
          data: c.createdAt,
          autor: c.author,
        })),
      })),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=dane_rodo_${dbUser._id}.json`,
    );
    return res.send(JSON.stringify(dataPackage, null, 2));
  } catch (err) {
    console.error("Błąd generowania paczki RODO:", err);
    return res.status(500).send("Błąd wewnętrzny serwera podczas eksportu.");
  }
}

// RODO Krok 1: Generowanie 24h tokenu bezpieczeństwa i wysyłka maila z linkiem takedown
async function postRequestDeleteAccount(req, res) {
  try {
    const dbUser = req.dbUser;
    const { confirmEmail } = req.body;

    if (
      !confirmEmail ||
      confirmEmail.trim().toLowerCase() !== dbUser.email.toLowerCase()
    ) {
      return res
        .status(400)
        .send(
          "Błąd: Wpisany adres e-mail nie zgadza się z adresem Twojego konta.",
        );
    }

    // Wykorzystujemy istniejący mechanizm wirtualnego tokenu (generuje token i securityTokenExpires na 24h)
    dbUser.token = 24;
    await dbUser.save();

    // Wywołanie modułu pocztowego do wysłania instrukcji usunięcia konta
    await mailer.sendAccountDeletionRequestEmail(dbUser, req);

    await createLog(
      req,
      `Zainicjowano procedurę usuwania konta. Wysłano link autoryzacyjny.`,
      dbUser.email,
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd podczas generowania tokenu kasowania konta:", err);
    return res.status(500).send("Wewnętrzny błąd serwera.");
  }
}

// RODO Krok 2: Finalne, nieodwracalne usunięcie konta po kliknięciu w link mailowy
async function getConfirmDeleteAccount(req, res) {
  try {
    const { token } = req.params;

    // Szukamy użytkownika po unikalnym tokenie bezpieczeństwa
    const user = await User.findOne({ securityToken: token });

    // Weryfikacja obecności i ważności tokenu (getter .token automatycznie sprawdza czas wygaśnięcia)
    if (!user || !user.token) {
      return res
        .status(403)
        .send(
          "Błąd: Link autoryzacyjny wygasł, jest nieprawidłowy lub został już wykorzystany.",
        );
    }

    const userId = user._id;
    const savedUserEmail = user.email;
    const savedUserName = user.name;
    const { Notification, Alias, Post } = require("../tools/db");

    // 1. Kaskadowe czyszczenie wszystkich śladów aktywności w bazie danych
    await Notification.deleteMany({
      $or: [{ senderId: userId }, { recipientId: userId }],
    });
    await Alias.deleteMany({ userId: userId });

    // Pobieramy i bezpowrotnie kasujemy posty użytkownika oraz powiązane z nimi zgłoszenia nadużyć
    const userPostsList = await Post.find({ authorId: userId }).select("_id");
    const userPostIds = userPostsList.map((p) => p._id);
    await Post.deleteMany({
      $or: [
        { authorId: userId },
        { parentPostId: { $in: userPostIds }, isAbuseReport: true },
      ],
    });

    // Odpinamy relacje nadrzędne w debatach, ustawiając parentPostId na null
    await Post.updateMany(
      { parentPostId: { $in: userPostIds }, isAbuseReport: false },
      { $set: { parentPostId: null } },
    );

    // Wyciągamy komentarze i polubienia z postów innych autorów
    await Post.updateMany(
      {},
      {
        $pull: {
          comments: { authorId: userId },
          likedBy: String(userId),
        },
      },
    );

    // 2. Bezwzględne usunięcie konta głównego z bazy danych
    await User.findByIdAndDelete(userId);

    // 3. Wysłanie ostatecznego powiadomienia o pomyślnym usunięciu danych (Koniec potoku)
    await mailer.sendAccountDeletionSuccessNotification(
      savedUserName,
      savedUserEmail,
    );

    // 4. Zniszczenie aktywnej sesji ciasteczka, jeśli użytkownik klikał będąc zalogowanym
    if (req.session) {
      req.session.destroy((err) => {
        if (err)
          console.error(
            "Błąd niszczenia sesji przy finalnym kasowaniu konta:",
            err,
          );
        res.clearCookie("connect.sid", { path: "/" });
        return res.render("email-verification", {
          verified: true,
          title: "Konto usunięte",
          customHeading: "Konto zostało trwale usunięte!",
          customMessage:
            "Zgodnie z Twoim żądaniem oraz prawem do bycia zapomnianym (RODO), wszystkie Twoje dane osobowe i powiązania zostały bezpowrotnie wymazane z platformy. Na Twoją skrzynkę wysłaliśmy oficjalne potwierdzenie zakończenia procedury.",
        });
      });
    } else {
      return res.render("email-verification", {
        verified: true,
        title: "Konto usunięte",
        customHeading: "Konto zostało trwale usunięte!",
      });
    }
  } catch (err) {
    console.error(
      "Krytyczny błąd podczas finalnego kasowania konta RODO:",
      err,
    );
    return res
      .status(500)
      .send("Wewnętrzny błąd serwera podczas usuwania danych.");
  }
}
