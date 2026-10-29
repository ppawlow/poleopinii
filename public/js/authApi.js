if (window.Alert === undefined) window.Alert = window.alert;

document.addEventListener("DOMContentLoaded", () => {
  const isCaptchaEnabled = window.env && window.env.useRecaptcha === true;
  const siteKey = window.env && window.env.RECAPTCHA_SITE_KEY;

  // Funkcja pomocnicza generująca token dla wybranej akcji
  function getCaptchaToken(actionName) {
    return new Promise((resolve) => {
      if (!isCaptchaEnabled || typeof grecaptcha === "undefined" || !siteKey) {
        return resolve("BYPASS_TOKEN_CAPTCHA_DISABLED");
      }
      grecaptcha.ready(() => {
        grecaptcha.execute(siteKey, { action: actionName })
          .then((token) => resolve(token))
          .catch((err) => {
            console.error("Błąd reCAPTCHA:", err);
            resolve(null);
          });
      });
    });
  }

  // =========================================================================
  // 1. FORMULARZ LOGOWANIA (Synchroniczny)
  // =========================================================================
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault(); // Wstrzymujemy wysyłkę na czas wygenerowania tokenu
      const tokenInput = document.getElementById("loginRecaptchaToken");
      
      const token = await getCaptchaToken("login_auth");
      if (tokenInput) tokenInput.value = token;
      
      loginForm.submit(); // Świadomie wysyłamy formularz dalej
    });
  }

  // =========================================================================
  // 2. FORMULARZ ZAPOMNIANEGO HASŁA (Synchroniczny z przekierowaniem)
  // =========================================================================
  const forgotPasswordForm = document.getElementById("forgotPasswordForm");
  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const tokenInput = document.getElementById("forgotRecaptchaToken");
      
      const token = await getCaptchaToken("forgot_password_auth");
      if (tokenInput) tokenInput.value = token;
      
      forgotPasswordForm.submit();
    });
  }

  // =========================================================================
  // 3. PROCES REJESTRACJI KONTA (Asynchroniczny Fetch API)
  // =========================================================================
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      const csrfToken = registerForm.getAttribute("data-csrf");
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Weryfikacja anty-botowa...";
      }

      const formData = new FormData(registerForm);
      const termsCheck = document.getElementById("termsCheck");
      const privacyCheck = document.getElementById("privacyCheck");
      if (termsCheck) formData.set("terms", termsCheck.checked ? "on" : "off");
      if (privacyCheck) formData.set("privacy", privacyCheck.checked ? "on" : "off");

      // Dynamicznie generujemy i wstrzykujemy token do paczki Fetch
      const token = await getCaptchaToken("register_auth");
      formData.set("recaptchaToken", token);

      const serializedData = new URLSearchParams(formData).toString();
      try {
        if (submitBtn) submitBtn.innerText = "Generowanie linku...";
        const response = await fetch("/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrfToken,
            Accept: "application/json",
          },
          body: serializedData,
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.msg === "registered_check_email") {
            registerForm.reset();
            await window.Alert(
              `✉️ <b>Weryfikacja tożsamości została zainicjowana!</b><br><br>Na adres <b>${data.email}</b> wysłaliśmy bezpieczny odnośnik aktywacyjny.<br>Otwórz swoją pocztę i kliknij w link.`,
              "📧 Sprawdź skrzynkę e-mail"
            );
          }
        } else {
          const errText = await response.text();
          let userFriendlyError = "Wystąpił błąd podczas rejestracji. Spróbuj ponownie.";

          if (errText.includes("zajęty") || errText.includes("exists")) {
            userFriendlyError = "⚠️ Podany adres e-mail jest już zajęty.";
          } else if (errText.includes("reCAPTCHA") || response.status === 403) {
            userFriendlyError = `⚠️ Odrzucono żądanie: ${errText}`;
          } else if (errText.includes("Błąd walidacji:")) {
            userFriendlyError = `⚠️ ${errText.replace("Błąd walidacji: ", "")}`;
          }

          await window.Alert(userFriendlyError, "❌ Rejestracja odrzucona");
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Zarejestruj się";
        }
      }
    });
  }

  // --- Obsługa ponownej wysyłki aktywacji mailowej (Ustawienia) ---
  const resendEmailForm = document.getElementById("resendEmailVerificationForm");
  if (resendEmailForm) {
    resendEmailForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitBtn = resendEmailForm.querySelector('button[type="submit"]');
      const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generowanie...';
      }
      try {
        const response = await fetch(resendEmailForm.action, {
          method: "POST",
          headers: {
            "X-CSRF-Token": csrfToken,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });
        if (response.ok) {
          await window.Alert("Nowy link weryfikacyjny został wysłany.", "Weryfikacja e-mail");
        }
      } catch (err) {
        console.error("Błąd:", err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Wyślij ponownie';
        }
      }
    });
  }
});
