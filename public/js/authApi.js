if (window.Alert === undefined) window.Alert = window.alert;

document.addEventListener("DOMContentLoaded", () => {
  const isCaptchaEnabled = window.env && window.env.useRecaptcha === true;
  const siteKey = window.env && window.env.RECAPTCHA_SITE_KEY;

  // Funkcja pomocnicza generująca token dla reCAPTCHA Enterprise
  function getCaptchaToken(actionName) {
    return new Promise((resolve) => {
      if (
        !isCaptchaEnabled ||
        typeof grecaptcha === "undefined" ||
        !grecaptcha.enterprise ||
        !siteKey
      ) return resolve("");

      grecaptcha.enterprise.ready(() => {
        grecaptcha.enterprise
          .execute(siteKey, { action: actionName })
          .then((token) => resolve(token))
          .catch((err) => {
            console.error("Błąd reCAPTCHA Enterprise:", err);
            resolve(null);
          });
      });
    });
  }

  // 1. FORMULARZ LOGOWANIA
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      if (document.getElementById("loginRecaptchaToken").value) {
        return; // Token już jest, pozwól na wysyłkę POST
      }

      e.preventDefault();
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const token = await getCaptchaToken("login_auth");
        // if (token) {
        if (token !== null) {          document.getElementById("loginRecaptchaToken").value = token;
          HTMLFormElement.prototype.submit.call(loginForm); // Bezpieczne ominięcie pętli eventu
        } else {
          if (submitBtn) submitBtn.disabled = false;
        }
      } catch (err) {
        console.error("Błąd logowania Captcha:", err);
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // 2. FORMULARZ ZAPOMNIANEGO HASŁA / ZMIANY HASŁA (ekran logowania oraz ustawienia konta)
  const forgotPasswordForm =
    document.getElementById("forgotPasswordForm") ||
    document.getElementById("passwordResetRequestForm");

  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Wysyłanie...";
      }

      try {
        const token = await getCaptchaToken("forgot_password_auth");
        if (token === null) return;

        const formData = new FormData(forgotPasswordForm);
        formData.set("recaptchaToken", token);

        const csrfToken =
          document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
          formData.get("_csrf");

        const response = await fetch(forgotPasswordForm.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrfToken,
            Accept: "application/json",
          },
          body: new URLSearchParams(formData).toString(),
        });

        if (response.ok) {
          // Jeśli to formularz na ekranie logowania (zawiera jawne pole email do wpisania), czyścimy je
          const emailInput = forgotPasswordForm.querySelector('input[type="email"][name="email"]');
          if (emailInput) emailInput.value = "";

          const isSettingsForm = forgotPasswordForm.id === "passwordResetRequestForm";
          const alertMsg = isSettingsForm
            ? "✉️ <b>Link do zmiany hasła został wysłany!</b><br><br>Sprawdź swoją skrzynkę pocztową i kliknij w przesłany odnośnik, aby ustawić nowe hasło."
            : "✉️ <b>Instrukcja została wysłana!</b><br><br>Jeśli podany adres e-mail istnieje w naszej bazie, wysłaliśmy na niego link umożliwiający zresetowanie hasła.";

          await window.Alert(alertMsg, "🔑 Odzyskiwanie i zmiana hasła");
        } else {
          const errText = await response.text();
          await window.Alert(
            `⚠️ Nie udało się przetworzyć żądania: ${errText || "Błąd serwera lub przekroczono limit prób."}`,
            "Błąd",
          );
        }
      } catch (err) {
        console.error("Błąd wysyłki linku resetującego hasło:", err);
        await window.Alert("Wystąpił błąd połączenia z serwerem.", "Błąd sieci");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    });
  }


  // 3. ASYNCHRONICZNA REJESTRACJA KONTA (FETCH API)
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const csrfToken = registerForm.getAttribute("data-csrf");
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Weryfikacja anty-botowa...";
      }

      const formData = new FormData(registerForm);

      // Pobranie tokenu tuż przed strzałem Fetch
      const token = await getCaptchaToken("register_auth");
      if (token === null) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Zarejestruj się";
        }
        return;
      }
         
      formData.set("recaptchaToken", token);

      const serializedData = new URLSearchParams(formData).toString();
      try {
        if (submitBtn) submitBtn.innerText = "Rejestrowanie...";
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
          if (data.success) {
            registerForm.reset();
            await window.Alert(
              `✉️ <b>Konto zainicjowane!</b><br><br>Na adres <b>${data.email}</b> wysłaliśmy link aktywacyjny.`,
              "📧 Sprawdź skrzynkę e-mail",
            );
          }
        } else {
          const errText = await response.text();
          await window.Alert(`⚠️ Rejestracja odrzucona: ${errText}`, "Błąd");
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

  // 4. PRZEŁĄCZNIK WIDOCZNOŚCI HASŁA (IKONA OKA)
  const bindPasswordToggle = (toggleId, inputId) => {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputId);
    if (!toggle || !input) return;
    toggle.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      toggle.classList.toggle("fa-eye", !isHidden);
      toggle.classList.toggle("fa-eye-slash", isHidden);
    });
  };
  bindPasswordToggle("toggleLoginPassword", "loginPasswordField");
  bindPasswordToggle("toggleResetPassword", "resetPasswordField");
  bindPasswordToggle("toggleConfirmPassword", "confirmPasswordField");
});
