// routes/verify.js
const express = require("express");
const crypto = require("crypto");
const { User, createLog, canonicalizeEmail } = require("../tools/db");
const { accessControl, appendUserData } = require("../tools/security");
const { BANK_TRANSFER_DATA } = require("../config");

module.exports = express
  .Router()
  .get("/email/:token", getVerifyEmail)
  // Dostęp tylko dla zalogowanych
  .use(accessControl)
  .get("/", getVerifyStatus)
  .get("/status", getStatusJson)
  .post("/submit-transfer", postSubmitTransfer);

async function getVerifyEmail(req, res) {
  try {
    const { token } = req.params;

    // 1. Szukamy użytkownika po unikalnym tokenie bezpieczeństwa
    const user = await User.findOne({ securityToken: token });

    // POPRAWKA: Mongoose zwraca null w przypadku braku dokumentu
    if (!user) {
      return res.render("email-verification", { verified: false });
    }

    // Sprawdzenie, czy token nie wygasł (obsługa wbudowanego wirtualnego gettera tokenu)
    if (!user.token) {
      return res.render("email-verification", { verified: false });
    }

    // POPRAWKA: Korzystamy z prawidłowej nazwy pola "newEmailPending" zdefiniowanej w schemacie db.js
    if (user.newEmailPending && user.newEmailPending.trim().length > 0) {
      const targetEmail = user.newEmailPending.trim();

      // POPRAWKA: Aktualizujemy adres podstawowy oraz generujemy nową postać kanoniczną e-maila
      user.email = targetEmail;
      user.normalizedEmail = canonicalizeEmail(targetEmail);
    }

    // Czyszczenie danych procesu weryfikacyjnego i unieważnienie tokenu
    user.newEmailPending = null;
    user.token = null;
    user.isVerified = true;

    // POPRAWKA: Zapewniamy asynchroniczny, pewny zapis w bazie danych MongoDB
    await user.save();

    await createLog(
      req,
      "Pomyślnie zweryfikowano i zmieniono adres e-mail",
      user.email,
    );

    // Bezpieczne czyszczenie aktywnej sesji (użytkownik musi zalogować się ponownie nowym mailem)
    if (req.session) {
      req.session.destroy((err) => {
        if (err)
          console.error("Błąd czyszczenia sesji przy zmianie e-maila:", err);
        res.clearCookie("connect.sid", { path: "/" });
        return res.render("email-verification", { verified: true });
      });
    } else {
      return res.render("email-verification", { verified: true });
    }
  } catch (err) {
    console.error(
      "Krytyczny błąd podczas weryfikacji nowego adresu e-mail:",
      err,
    );
    return res.status(500).send("Wewnętrzny błąd serwera podczas weryfikacji.");
  }
}

async function getVerifyStatus(req, res) {
  try {
    const user = req.dbUser;

    await appendUserData(res.locals.user, `verificationTransferStatus`);
    await appendUserData(res.locals.user, `verificationTransferCode`);

    // POPRAWKA: Kod pobierany jest zawsze z bazy, nigdy nie jest generowany tymczasowo w sesji
    const dynamicTransferCode = user.verificationTransferCode;

    res.render("verify", {
      title: "Weryfikacja użytkownika",
      BANK_TRANSFER_DATA,
      dynamicTransferCode,
      msg: req.query.msg,
      error: req.query.error,
    });
  } catch (err) {
    console.error("Błąd ładowania statusu weryfikacji:", err);
    res.status(500).send("Wewnętrzny błąd serwera");
  }
}

async function postSubmitTransfer(req, res) {
  try {
    const user = req.dbUser;

    if (
      user.verificationTransferStatus === "approved" ||
      user.verificationTransferStatus === "processing"
    ) {
      return res.status(400).json({
        error: "Błąd: Zgłoszenie zostało już przesłane lub zatwierdzone.",
      });
    }

    // KRYTYCZNA POPRAWKA: Nie odczytujemy req.body.transferCode!
    // Status zmieniamy na podstawie kodu, który serwer bezpiecznie przechowuje w bazie.
    user.verificationTransferStatus = "processing";
    await user.save();

    await createLog(
      req,
      `Użytkownik zatwierdził przelew weryfikacyjny z kodem: ${user.verificationTransferCode}`,
      user.email,
    );

    return res.json({ success: true, status: "processing" });
  } catch (err) {
    console.error("Błąd zapisu przelewu:", err);
    return res.status(500).json({ error: "Błąd wewnętrzny serwera" });
  }
}

async function getStatusJson(req, res) {
  return res.json({
    isVerified: req.dbUser.isVerified,
    transferStatus: req.dbUser.verificationTransferStatus,
    isFullyVerified:
      req.dbUser.isVerified &&
      req.dbUser.verificationTransferStatus === "approved",
  });
}
