// routes/verify.js
const express = require("express");
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

    const user = await User.findOne({ securityToken: token });

    if (!user) {
      return res.render("email-verification", { verified: false });
    }

    if (!user.token) {
      return res.render("email-verification", { verified: false });
    }

    if (user.newEmailPending && user.newEmailPending.trim().length > 0) {
      const targetEmail = user.newEmailPending.trim();
      user.email = targetEmail;
      user.normalizedEmail = canonicalizeEmail(targetEmail);
    }

    user.newEmailPending = null;
    user.token = null;
    user.isVerified = true;

    await user.save();

    await createLog(
      req,
      "Pomyślnie zweryfikowano i zmieniono adres e-mail",
      user.email,
    );

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

    await appendUserData(res.locals.user, "verificationTransferStatus");
    await appendUserData(res.locals.user, "verificationTransferCode");

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
  const isAjax =
    req.xhr ||
    req.headers["x-requested-with"] === "XMLHttpRequest" ||
    (req.headers.accept && req.headers.accept.includes("application/json"));

  try {
    const user = req.dbUser;

    if (
      user.verificationTransferStatus === "approved" ||
      user.verificationTransferStatus === "processing"
    ) {
      const msg = "Błąd: Zgłoszenie zostało już przesłane lub zatwierdzone.";
      return isAjax
        ? res.status(400).json({ error: msg })
        : res.redirect("/verify?msg=transfer_submitted");
    }

    user.verificationTransferStatus = "processing";
    await user.save();

    await createLog(
      req,
      `Użytkownik zatwierdził przelew weryfikacyjny z kodem: ${user.verificationTransferCode}`,
      user.email,
    );

    if (isAjax) {
      return res.json({ success: true, status: "processing" });
    }
    return res.redirect("/verify?msg=transfer_submitted");
  } catch (err) {
    console.error("Błąd zapisu przelewu:", err);
    if (isAjax) {
      return res.status(500).json({ error: "Błąd wewnętrzny serwera." });
    }
    return res.redirect("/verify?error=server");
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
