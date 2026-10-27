if (window.Alert === undefined) window.Alert = window.alert;

document.addEventListener("DOMContentLoaded", () => {
  // --- Obsługa przycisku resetu hasła ---
  const passwordResetForm = document.getElementById("passwordResetRequestForm");
  if (passwordResetForm) {
    const emailField = document.getElementById("settingsEmailField");
    passwordResetForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        .getAttribute("content");
      try {
        const response = await fetch(passwordResetForm.action, {
          method: "POST",
          headers: {
            "X-CSRF-Token": csrfToken,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });
        if (response.ok) {
          await window.Alert(
            `Link zmiany hasła został pomyślnie przesłany na adres ${emailField ? emailField.value : "Twój e-mail"}.`,
            "Weryfikacja e-mail",
          );
        }
      } catch (err) {
        console.error("Błąd sieciowy:", err);
      }
    });
  }

  // --- Obsługa ponownej wysyłki aktywacji mailowej ---
  const resendEmailForm = document.getElementById(
    "resendEmailVerificationForm",
  );
  if (resendEmailForm) {
    resendEmailForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitBtn = resendEmailForm.querySelector('button[type="submit"]');
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        .getAttribute("content");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Generowanie...';
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
          await window.Alert(
            "Nowy link weryfikacyjny został wysłany.",
            "Weryfikacja e-mail",
          );
        }
      } catch (err) {
        console.error("Błąd:", err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML =
            '<i class="fa-solid fa-paper-plane"></i> Wyślij ponownie';
        }
      }
    });
  }

  // --- Proces Rejestracji Konta ---
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const csrfToken = registerForm.getAttribute("data-csrf");
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Generowanie linku...";
      }

      const formData = new FormData(registerForm);
      // Pobieramy wartości pól checkbox i jawnie wymuszamy ich obecność w formacie URL-encoded
      const termsCheck = document.getElementById("termsCheck");
      const privacyCheck = document.getElementById("privacyCheck");
      if (termsCheck) formData.set("terms", termsCheck.checked ? "on" : "off");
      if (privacyCheck)
        formData.set("privacy", privacyCheck.checked ? "on" : "off");

      const serializedData = new URLSearchParams(formData).toString();
      try {
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
              "📧 Sprawdź skrzynkę e-mail",
            );
          }
        } else {
          const errText = await response.text();
          let userFriendlyError =
            "Wystąpił błąd podczas rejestracji. Spróbuj ponownie.";

          if (errText.includes("zajęty") || errText.includes("exists")) {
            userFriendlyError = "⚠️ Podany adres e-mail jest już zajęty.";
          } else if (
            errText.includes("Błąd walidacji:") ||
            errText.includes("Regulaminu") ||
            errText.includes("Polityki")
          ) {
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
});
