if (window.Alert === undefined) window.Alert = window.alert;

document.addEventListener("DOMContentLoaded", () => {
  const isCaptchaEnabled = window.env && window.env.useRecaptcha === true;
  const siteKey = window.env && window.env.RECAPTCHA_SITE_KEY;

  // Funkcja pomocnicza generująca token dla reCAPTCHA Enterprise
  function getCaptchaToken(actionName) {
    return new Promise((resolve) => {
      if (!isCaptchaEnabled || typeof grecaptcha === "undefined" || !grecaptcha.enterprise || !siteKey) {
        return resolve("BYPASS_TOKEN_CAPTCHA_DISABLED");
      }
      grecaptcha.enterprise.ready(() => {
        grecaptcha.enterprise.execute(siteKey, { action: actionName })
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
        if (token) {
          document.getElementById("loginRecaptchaToken").value = token;
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

  // 2. FORMULARZ ZAPOMNIANEGO HASŁA
  const forgotPasswordForm = document.getElementById("forgotPasswordForm");
  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener("submit", async function (e) {
      if (document.getElementById("forgotRecaptchaToken").value) {
        return;
      }
      
      e.preventDefault();
      const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const token = await getCaptchaToken("forgot_password_auth");
        if (token) {
          document.getElementById("forgotRecaptchaToken").value = token;
          HTMLFormElement.prototype.submit.call(forgotPasswordForm);
        } else {
          if (submitBtn) submitBtn.disabled = false;
        }
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
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
              "📧 Sprawdź skrzynkę e-mail"
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
});
