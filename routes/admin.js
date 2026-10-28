// routes/admin.js
const express = require("express");
const { ObjectId } = require("mongodb");
const mailer = require("../tools/mailer");
const crypto = require("crypto");
const { User, Post, SystemLog, createLog } = require("../tools/db");
const { adminControl } = require("../tools/security");
const { adminApprovalValidationRules } = require("../tools/validation");

module.exports = express
  .Router()
  .use(adminControl)
  .get("/", main)
  .get("/logs/api", getLogsApi) // Nowy endpoint dla asynchronicznego selektora daty
  .post("/:reportId/accept", postAcceptAbuseReport)
  .post("/:reportId/reject", postRejectAbuseReport)
  .post("/posts/:postId/unlock", postUnlockModeratorFlag)
  .post("/verify-user/:userId/approve", adminApprovalValidationRules, postAdminApproveUser)
  .post("/verify-user/:userId/reject", postAdminRejectUser)
  .delete("/topics/:topicId", postDeleteAiTopic);

// Pomocnicza funkcja formatująca wpis logu prasowego
function mapLogDocument(log) {
  const ip = log.ipAddress ? log.ipAddress.trim() : "127.0.0.1";
  let displayUser = log.fallbackName || "Gość";

  if (log.userId) {
    const currentName = log.userId.name || "Użytkownik";
    const shortId = String(log.userId._id).substring(18);
    displayUser = `${currentName} (${shortId})`;
  }

  return {
    createdAt: log.createdAt,
    userId: log.userId,
    userDisplayName: displayUser,
    ipAddress: ip,
    action: log.action,
  };
}

async function main(req, res) {
  try {
    const reports = await Post.find({ isAbuseReport: true })
      .sort({ createdAt: -1 })
      .populate("authorId", "name avatarUrl")
      .populate("parentPostId", "title visibility isModeratorLocked")
      .lean();

    const pendingUsers = await User.find({
      verificationTransferStatus: "processing",
    }).lean();

    // DOMYŚLNY FILTR: Ostatnie 24 godziny dla widoku startowego
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await SystemLog.find({ createdAt: { $gte: twentyFourHoursAgo } })
      .sort({ createdAt: -1 })
      .populate("userId")
      .lean();

    const formattedLogs = logs.map(mapLogDocument);

    const usersStats = await User.aggregate([
      { $lookup: { from: "posts", localField: "_id", foreignField: "authorId", as: "userPosts" } },
      {
        $project: {
          name: 1, email: 1, alias: 1,
          aiBlockedSafetyCount: { $ifNull: ["$aiBlockedSafetyCount", 0] },
          aiBlockedFactCheckCount: { $ifNull: ["$aiBlockedFactCheckCount", 0] },
          publicCount: { $size: { $filter: { input: "$userPosts", as: "p", cond: { $and: [{ $eq: ["$$p.visibility", "public"] }, { $ne: ["$$p.isAbuseReport", true] }] } } } },
          restrictedCount: { $size: { $filter: { input: "$userPosts", as: "p", cond: { $eq: ["$$p.visibility", "restricted"] } } } },
          privateCount: { $size: { $filter: { input: "$userPosts", as: "p", cond: { $eq: ["$$p.visibility", "private"] } } } },
          totalStars: { $reduce: { input: "$userPosts", initialValue: 0, in: { $sum: ["$$value", { $size: { $ifNull: ["$$this.likedBy", []] } }] } } }
        }
      },
      { $sort: { name: 1 } }
    ]);

    res.render("admin", {
      title: "Panel Zarządzania Systemem",
      reports: reports || [],
      pendingUsers: pendingUsers || [],
      logs: formattedLogs || [],
      systemUsers: usersStats || [],
      currentTab: "admin",
      queryError: req.query.error || null,
      queryMsg: req.query.msg || null,
      customMsg: req.query.customMsg || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Błąd serwera.");
  }
}

// Handler asynchronicznego API filtrujący po dacie (wybrany dzień od 00:00:00 do 23:59:59)
async function getLogsApi(req, res) {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).send("Brak parametru daty.");

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const logs = await SystemLog.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    })
    .sort({ createdAt: -1 })
    .populate("userId")
    .lean();

    const formattedLogs = logs.map(mapLogDocument);

    // Renderujemy partial i odsyłamy czysty kod HTML w formacie JSON
    req.app.render("partials/admin-logs-rows", { logs: formattedLogs }, (err, html) => {
      if (err) return res.status(500).send("Błąd generowania wierszy tabeli.");
      res.json({ success: true, count: formattedLogs.length, html });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera API logów." });
  }
}

async function postAcceptAbuseReport(req, res) {
  try {
    const { reportId } = req.params;
    if (!ObjectId.isValid(reportId)) {
      return res.status(400).send("Nieprawidłowy identyfikator zgłoszenia.");
    }

    const reportPost = await Post.findById(reportId);
    if (!reportPost || !reportPost.isAbuseReport || !reportPost.parentPostId) {
      return res
        .status(404)
        .send("Nie odnaleziono poprawnego zgłoszenia nadużycia.");
    }

    const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
    const timeElapsed = Date.now() - new Date(reportPost.createdAt).getTime();
    if (timeElapsed < threeDaysInMs) {
      return res
        .status(400)
        .send(
          "Blokada: Nie można podjąć decyzji przed upływem 3 dni od zgłoszenia (czas na obronę autora).",
        );
    }

    const originalPost = await Post.findById(reportPost.parentPostId);
    if (originalPost) {
      originalPost.visibility = "restricted";
      originalPost.isModeratorLocked = true;
      await originalPost.save();
      await createLog(req, `[MODERACJA] Zaakceptowano zgłoszenie nadużycia.`);

      // Wywołanie poprawionego mailera z nową logiką dynamicznych adresów e-mail
      await mailer.sendAbuseReportAcceptedEmails(originalPost, reportPost);
    }

    // Usuwamy zgłoszenie nadużycia z rejestru (zostało pomyślnie rozpatrzone)
    await Post.findByIdAndDelete(reportPost._id);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd podczas akceptacji zgłoszenia przez moderatora:", err);
    return res.status(500).send("Wewnętrzny błąd serwera moderacji.");
  }
}

async function postRejectAbuseReport(req, res) {
  try {
    const { reportId } = req.params;
    if (!ObjectId.isValid(reportId))
      return res.status(400).send("Nieprawidłowy ID zgłoszenia.");

    const reportPost = await Post.findById(reportId);
    if (!reportPost || !reportPost.isAbuseReport || !reportPost.parentPostId) {
      return res.status(404).send("Nie odnaleziono zgłoszenia.");
    }

    const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
    const timeElapsed = Date.now() - new Date(reportPost.createdAt).getTime();
    if (timeElapsed < threeDaysInMs) {
      return res
        .status(400)
        .send(
          "Blokada: Nie można podjąć decyzji przed upływem 3 dni od zgłoszenia (czas na obronę autora).",
        );
    }

    const originalPost = await Post.findById(reportPost.parentPostId);

    // POPRAWKA: Zamiast chaotycznego kodu bezpośrednio w kontrolerze,
    // wywołujemy zunifikowaną metodę z modułu mailera
    await mailer.sendAbuseReportRejectedEmails(originalPost, reportPost);

    // Usuwamy zgłoszenie nadużycia z rejestru jako niezasadne
    await Post.findByIdAndDelete(reportPost._id);
    await createLog(
      req,
      `[MODERACJA] Odrzucono zgłoszenie nadużycia o ID: ${reportPost._id}. Post oryginalny oczyszczony z zarzutów.`,
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd podczas odrzucania zgłoszenia przez moderatora:", err);
    return res.status(500).send("Błąd serwera moderacji.");
  }
}

// HANDLER: COFANIE BLOKADY MODERATORSKIEJ POSTA (ZDJĘCIE BLOKADY WIDOCZNOŚCI)
async function postUnlockModeratorFlag(req, res) {
  try {
    const { postId } = req.params;
    if (!ObjectId.isValid(postId))
      return res.status(400).send("Nieprawidłowy ID posta.");

    const post = await Post.findById(postId);
    if (!post) return res.status(404).send("Nie odnaleziono wpisu.");

    if (!post.isModeratorLocked) {
      return res
        .status(400)
        .send("Ten post nie posiada nałożonej blokady moderatorskiej.");
    }

    // 1. Zdejmujemy flagę blokady moderatorskiej
    post.isModeratorLocked = false;
    await post.save();

    // 2. Informujemy autora mailowo o zdjęciu restrykcji
    if (post.authorEmail) {
      try {
        const mailTemplates = require("../tools/mailTemplates");
        const { sendMail } = require("../tools/mailer");
        const unlockMailContent =
          mailTemplates.getAuthorUnlockNotificationEmail(
            post.author,
            post.title || "Wpis bez tytułu",
            SERVICE_NAME,
          );

        await sendMail(
          post.authorEmail,
          "🔓 Odblokowanie profilu: Możesz ponownie upublicznić post",
          unlockMailContent,
        );
      } catch (e) {
        console.error(e);
      }
    }

    await createLog(
      req,
      `[MODERACJA] Zdjęto blokadę moderatorską z posta o ID: ${post._id}. Autor odzyskał uprawnienia upubliczniania.`,
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Błąd podczas zdejmowania blokady.");
  }
}

async function postAdminApproveUser(req, res) {
  const { userId } = req.params;

  // KRYTYCZNA POPRAWKA: Ręcznie usuwamy wszystkie spacje z req.body.bankAccount
  // ZANIM express-validator w ogóle go dotknie i zacznie walidować.
  if (req.body && req.body.bankAccount) {
    req.body.bankAccount = String(req.body.bankAccount).replace(/\s+/g, "");
  }

  // Pobranie i obsługa błędów walidacji matematycznej numeru konta
  const { validationResult } = require("express-validator");
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorMsg = errors
      .array()
      .map((e) => e.msg)
      .join(" ");

    return res.status(400).send(errorMsg);
  }

  const { bankAccount } = req.body;

  try {
    const cleanAccount = bankAccount;

    // Generujemy nieodwracalny, bezpieczny skrót SHA-256
    const hashedAccount = crypto
      .createHash("sha256")
      .update(cleanAccount)
      .digest("hex");

    // Sprawdzenie unikalności skrótu w bazie danych MongoDB
    const duplicateExists = await User.findOne({
      verificationBankAccount: hashedAccount,
      verificationTransferStatus: "approved",
    });

    if (duplicateExists) {
      return res
        .status(400)
        .send(
          "Blokada: To konto bankowe było już użyte i przypisane do innego profilu!",
        );
    }

    const targetUser = await User.findById(userId);
    if (!targetUser)
      return res.status(404).send("Nie odnaleziono użytkownika.");

    targetUser.verificationBankAccount = hashedAccount;
    targetUser.verificationTransferStatus = "approved";
    targetUser.isVerified = true;
    await targetUser.save();

    await createLog(
      req,
      `[ADMIN - WERYFIKACJA] Zweryfikowano pomyślnie profil: ${targetUser.displayName}`,
    );
    await mailer.sendVerificationSuccessEmail(targetUser);

    return res.redirect("/admin?msg=user_approved");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Wewnętrzny błąd serwera.");
  }
}

async function postAdminRejectUser(req, res) {
  const { userId } = req.params;
  const { adminComment } = req.body; // Opcjonalny komentarz wpisany przez Admina w formularzu

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser)
      return res.status(404).send("Nie odnaleziono użytkownika.");

    // Odrzucenie i reset statusu do poprawek
    targetUser.verificationTransferStatus = "rejected";
    await targetUser.save();

    await createLog(
      req,
      `[ADMIN - ODZUCENIE WERYFIKACJI] Odrzucono weryfikację konta: ${targetUser.displayName}`,
    );

    // Wysyłka maila o przyczynie odrzucenia (wraz z komentarzem Admina)
    await mailer.sendVerificationRejectedEmail(targetUser, adminComment);

    return res.redirect("/admin?msg=user_rejected");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Wewnętrzny błąd serwera.");
  }
}

// HANDLER: Ręczne usuwanie faktu dnia AI przez Administratora
async function postDeleteAiTopic(req, res) {
  try {
    const { topicId } = req.params;

    if (!ObjectId.isValid(topicId)) {
      return res.status(400).send("Nieprawidłowy identyfikator tematu.");
    }

    const { TopicOfTheDay } = require("../tools/db");
    const deletedTopic = await TopicOfTheDay.findByIdAndDelete(topicId);

    if (!deletedTopic) {
      return res
        .status(404)
        .send("Nie odnaleziono podanego tematu w bazie danych.");
    }

    // Rejestracja zdarzenia w logach audytowych platformy
    await createLog(
      req,
      `[MODERACJA AI] Administrator usunął ręcznie temat dnia: "${deletedTopic.title}"`,
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd podczas usuwania tematu AI przez administratora:", err);
    return res
      .status(500)
      .send("Wewnętrzny błąd serwera podczas usuwania zasobu.");
  }
}
