const express = require("express");
const bcrypt = require("bcrypt");
const { SALT_ROUNDS, PASSWORD_REGEX, isDevelopment } = require("../config");
const { User, createLog, canonicalizeEmail } = require("../tools/db");
const { isUser, isGuest } = require("../tools/security");
const {
  loginValidationRules,
  registerValidationRules,
  authLimiter,
  tokenGenerationLimiter,
  validationResult,
  setInitialPasswordValidationRules,
} = require("../tools/validation");

const mailer = require("../tools/mailer");

module.exports = express
  .Router()
  .get("/logout", isUser, getLogout)

  // Wspólny punkt wejścia GET i POST dla KAŻDEJ zmiany hasła za pomocą bezpiecznego linku
  .get("/set-password/:token", getSetPassword)
  .post(
    "/set-password/:token",
    authLimiter,
    setInitialPasswordValidationRules,
    postSetPassword,
  )
  // Dostępne tylko dla niezalogowanych
  .use(isGuest)
  .get("/login", getLogin)
  .get("/register", getRegister)
  .get("/forgot-password", getForgotPassword)
  .post("/login", authLimiter, loginValidationRules, postLogin)
  .post("/register", authLimiter, registerValidationRules, postRegister)
  .post("/forgot-password", tokenGenerationLimiter, postForgotPassword);

function getLogin(req, res) {
  res.render("login", {
    title: "Zaloguj się",
    error: req.query.error,
    msg: req.query.msg,
  });
}

function getLogout(req, res) {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) console.error("Błąd podczas niszczenia sesji:", err);
      res.clearCookie("connect.sid", { path: "/" });
      res.redirect("/");
    });
  } else res.redirect("/");
}

function getRegister(req, res) {
  res.render("register", {
    title: "Utwórz nowe konto",
    error: req.query.error,
    msg: req.query.msg,
  });
}

async function postLogin(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.redirect("/auth/login?error=1");
  }

  // WERYFIKACJA reCAPTCHA
  const { verifyRecaptcha } = require("../tools/validation");
  const ip = req.ip || "127.0.0.1";
  const isHuman = await verifyRecaptcha(req.body.recaptchaToken, ip);
  if (!isHuman) {
    return res.redirect("/auth/login?error=1"); // Traktujemy bota jako błąd logowania
  }

  const { email, password } = req.body;
  try {
    const targetNormalizedEmail = canonicalizeEmail(email);
    const foundUser = await User.findOne({
      normalizedEmail: targetNormalizedEmail,
    });

    if (foundUser) {
      if (!foundUser.password) {
        return res.redirect("/auth/login?error=not_verified");
      }

      const match = await bcrypt.compare(password, foundUser.password);
      if (match) {
        return req.session.regenerate(async (err) => {
          if (err) return res.redirect("/auth/login?error=server");
          req.session.user = { id: foundUser._id };
          await createLog(req, "Zalogowano pomyślnie", foundUser.email);
          return req.session.save(() => res.redirect("/"));
        });
      }
    }

    await createLog(
      req,
      `Nieudana próba logowania dla adresu: ${email}`,
      "System-Uwierzytelniania",
    );
    return res.redirect("/auth/login?error=1");
  } catch (err) {
    console.error("Krytyczny błąd podczas logowania użytkownika:", err);
    return res.redirect("/auth/login?error=server");
  }
}

// ETAP 1 REJESTRACJI: Rejestracja i wygenerowanie linku
// routes/auth.js - Uproszczenie postRegister przez db.addUser()

async function postRegister(req, res) {
  const { name, email, terms, privacy, recaptchaToken } = req.body;

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (
      req.xhr ||
      (req.headers.accept && req.headers.accept.indexOf("json") > -1)
    ) {
      return res.status(400).send(
        errors
          .array()
          .map((e) => e.msg)
          .join(" "),
      );
    }
    return res.status(400).render("register", {
      title: "Utwórz nowe konto",
      error: "validation",
      customErrorMessage: errors
        .array()
        .map((e) => e.msg)
        .join(" "),
      formData: { name, email, terms: !!terms, privacy: !!privacy },
    });
  }

  // WERYFIKACJA reCAPTCHA
  const { verifyRecaptcha } = require("../tools/validation");
  const ip = req.ip || "127.0.0.1";
  const isHuman = await verifyRecaptcha(recaptchaToken, ip);
  if (!isHuman) {
    return res
      .status(403)
      .send(
        "Weryfikacja anty-botowa nieudana. Ruch zakwalifikowany jako automatyczny spam.",
      );
  }

  try {
    const { addUser } = require("../tools/db");
    const result = await addUser(name, email);

    if (result.error) {
      return res.status(400).json({ error: "exists" });
    }

    await createLog(
      req,
      `Zainicjowano rejestrację konta: ${result.email}`,
      result.email,
    );
    await mailer.sendVerificationEmail(result, req);
    await createLog(
      req,
      `[SYSTEM MAIL] Wysłano link aktywacyjny do: ${result.email}`,
      result.email,
    );

    return res.json({
      success: true,
      msg: "registered_check_email",
      email: result.email,
    });
  } catch (err) {
    console.error("Krytyczny błąd podczas rejestracji (postRegister):", err);
    return res.status(500).json({ error: "server" });
  }
}

// PROCEDURA ZAPOMNIANEGO HASŁA (POST) - routes/auth.js
async function postForgotPassword(req, res) {
  const { email, recaptchaToken } = req.body;

  // WERYFIKACJA reCAPTCHA
  const { verifyRecaptcha } = require("../tools/validation");
  const ip = req.ip || "127.0.0.1";
  const isHuman = await verifyRecaptcha(recaptchaToken, ip);
  if (!isHuman) {
    return res.redirect("/auth/forgot-password?msg=sent"); // Ciche odrzucenie bota (udajemy sukces)
  }

  try {
    if (!email || typeof email !== "string") {
      return res.redirect("/auth/forgot-password?msg=sent");
    }

    const targetNormalizedEmail = canonicalizeEmail(email);
    const user = await User.findOne({ normalizedEmail: targetNormalizedEmail });

    if (user) {
      user.token = 1;
      await user.save();
      await mailer.sendPasswordResetEmail(user, req);
    }

    return res.redirect("/auth/forgot-password?msg=sent");
  } catch (err) {
    console.error("Błąd podczas generowania linku resetu:", err);
    return res.redirect("/auth/forgot-password?error=server");
  }
}
// ZUNIFIKOWANY FORMULARZ USTAWIANIA HASŁA (GET)
async function getSetPassword(req, res) {
  try {
    const user = await User.findOne({
      securityToken: req.params.token,
    });

    if (!user?.token) return res.redirect("/auth/login?error=invalid_token");

    // KRYTYCZNA POPRAWKA: Renderujemy plik views/reset-password.pug dla obu akcji
    res.render("reset-password", {
      title: "Ustaw hasło dostępu",
      token: req.params.token,
      error: req.query.error,
      isInitial: !user.isVerified, // Jeśli konto nie jest jeszcze zweryfikowane, to pierwsza rejestracja
    });
  } catch (err) {
    res.redirect("/auth/login?error=server");
  }
}

// routes/auth.js - Wspólny handler zapisu hasła (POST)
async function postSetPassword(req, res) {
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.redirect(
      `/auth/set-password/${req.params.token}?error=mismatch`,
    );
  }

  if (!PASSWORD_REGEX.test(password)) {
    return res.redirect(
      `/auth/set-password/${req.params.token}?error=weak_password`,
    );
  }

  try {
    const user = await User.findOne({
      securityToken: req.params.token,
    });

    if (!user?.token) {
      if (user) await user.save();
      return res.redirect("/auth/login?error=invalid_token");
    }

    const wasInitialRegistration = !user.isVerified;

    user.password = await bcrypt.hash(password, SALT_ROUNDS);
    user.isVerified = true;

    user.token = null; // Czyszczenie i unieważnienie tokenu bezpieczeństwa
    await user.save();

    await createLog(
      req,
      "Hasło zostało pomyślnie zaktualizowane kluczem tokenu",
      user.email,
    );

    if (wasInitialRegistration) {
      // SCENARIUSZ A: Pierwsza rejestracja -> automatyczne logowanie i wejście na profil
      return req.session.regenerate((err) => {
        if (err) return res.redirect("/auth/login?error=server");
        req.session.user = { id: user._id };
        req.session.save(() => res.redirect("/profile/settings"));
      });
    } else {
      // SCENARIUSZ B: Reset zapomnianego hasła -> niszczenie starych sesji i powrót do logowania
      if (req.session) {
        return req.session.destroy((err) => {
          if (err)
            console.error(
              "Błąd podczas czyszczenia sesji przy resecie hasła:",
              err,
            );
          res.clearCookie("connect.sid", { path: "/" });
          return res.redirect("/auth/login?msg=verified");
        });
      } else {
        return res.redirect("/auth/login?msg=verified");
      }
    }
  } catch (err) {
    console.error("Błąd zapisu zunifikowanego hasła:", err);
    res.redirect("/auth/login?error=server");
  }
}

function getRegister(req, res) {
  res.render("register", {
    title: "Utwórz nowe konto",
    error: req.query.error,
    msg: req.query.msg,
  });
}

// NOWOŚĆ: Funkcja renderująca widok formularza odzyskiwania hasła
function getForgotPassword(req, res) {
  res.render("forgot-password", {
    title: "Odzyskiwanie hasła",
    error: req.query.error,
    msg: req.query.msg,
  });
}
