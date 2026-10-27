if (window.Alert === undefined) window.Alert = window.alert;

document.addEventListener("DOMContentLoaded", () => {
  // =========================================================================
  // 1. SZYBKA AKTUALIZACJA BIO NA PROFILU (FETCH API)
  // =========================================================================
  const bioEditForm = document.getElementById("bio-edit-form");
  const bioTextContent = document.getElementById("bio-text-content");

  if (bioEditForm && bioTextContent) {
    bioEditForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();

      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        .getAttribute("content");
      const formData = new URLSearchParams(
        new FormData(bioEditForm),
      ).toString();

      try {
        const response = await fetch(bioEditForm.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrfToken,
          },
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            bioTextContent.innerText = data.bio;
            document.getElementById("bio-view-mode").style.display = "block";
            document.getElementById("bio-edit-mode").style.display = "none";
          }
        }
      } catch (err) {
        console.error("Błąd aktualizacji bio:", err);
      }
    });
  }

  // =========================================================================
  // 2. ZUNIFIKOWANY FORMULARZ USTAWIEŃ KONTA Z AUTORYZACJĄ HASŁA (FETCH API)
  // =========================================================================
  const settingsForm = document.getElementById("settingsForm");
  const emailField = document.getElementById("settingsEmailField");
  const modal = document.getElementById("password-auth-modal");

  if (settingsForm && emailField && modal) {
    const modalInput = document.getElementById("modalPasswordField");
    const cancelBtn = document.getElementById("modalCancelBtn");
    const confirmBtn = document.getElementById("modalConfirmBtn");
    const hiddenPasswordInput = document.getElementById(
      "hiddenCurrentPassword",
    );
    let originalEmail = emailField.value.trim().toLowerCase();

    async function executeSettingsSubmitAsync() {
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        .getAttribute("content");
      const formData = new FormData(settingsForm);
      const privateEmailCheck = document.getElementById(
        "allowPrivateEmailsCheck",
      );

      if (privateEmailCheck) {
        formData.set("allowPrivateEmails", privateEmailCheck.checked);
      }
      const serializedData = new URLSearchParams(formData).toString();

      try {
        const response = await fetch(settingsForm.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrfToken,
            Accept: "application/json",
          },
          body: serializedData,
        });

        const responseText = await response.text();
        let data = {};
        try {
          data = JSON.parse(responseText);
        } catch (e) {}

        if (response.ok) {
          if (data.success) {
            originalEmail = emailField.value.trim().toLowerCase();
            hiddenPasswordInput.value = "";
            const modalMessage =
              data.msg === "email_pending"
                ? "Zapisano dane profilu!<br><br>✉️ Na Twój nowo wprowadzony adres e-mail wysłaliśmy bezpieczny link aktywacyjny."
                : "🎉 Ustawienia Twojego konta zostały pomyślnie zaktualizowane";

            await window.Alert(modalMessage, "⚙️ Aktualizacja profilu");
            window.location.href =
              "/profile/settings?msg=" +
              (data.msg === "email_pending" ? "email_pending" : "updated");
          }
        } else {
          let errorMsg = "Wystąpił nieoczekiwany błąd podczas zapisu.";
          if (data && data.error) {
            switch (data.error) {
              case "exists":
                errorMsg =
                  "⚠️ Podany adres e-mail jest już zajęty przez innego użytkownika.";
                break;
              case "invalid_password":
                errorMsg =
                  "⚠️ Podane hasło autoryzacyjne jest nieprawidłowe. Zmiana adresu e-mail została odrzucona.";
                break;
              case "password_required":
                errorMsg =
                  "🔒 Zmiana adresu e-mail wymaga autoryzacji. Wprowadź hasło.";
                break;
              default:
                errorMsg = `⚠️ ${data.error}`;
            }
          }

          await window.Alert(errorMsg, "Błąd aktualizacji konta");
        }
      } catch (err) {
        console.error("Błąd sieciowy wysyłki formularza ustawień:", err);
        await window.Alert(
          "Wystąpił błąd połączenia sieciowego podczas zapisu danych.",
          "Błąd sieci",
        );
      }
    }

    settingsForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (
        emailField.value.trim().toLowerCase() !== originalEmail &&
        hiddenPasswordInput.value.trim().length === 0
      ) {
        modal.style.display = "flex";
        modalInput.value = "";
        modalInput.focus();
      } else {
        executeSettingsSubmitAsync();
      }
    });

    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (modalInput.value.trim().length === 0) return;
        hiddenPasswordInput.value = modalInput.value;
        modal.style.display = "none";
        executeSettingsSubmitAsync();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }
  }
});

// =========================================================================
// 3. ASYNCHRONICZNE PRZESYŁANIE ZDJĘĆ PROFILOWYCH (AVATAR / COVER)
// =========================================================================
async function uploadProfilePhoto(input) {
  if (!input.files || !input.files[0]) return;
  const form = input.closest("form");
  const formData = new FormData(form);
  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: formData,
    });
    if (response.ok) window.location.reload(true);
  } catch (err) {
    console.error("Błąd wgrywania zdjęcia:", err);
  }
}
window.uploadProfilePhoto = uploadProfilePhoto;

// =========================================================================
// 4. OBSŁUGA PRYWATNYCH WIADOMOŚCI KOMUNIKACJI PEER-TO-PEER (MAILER)
// =========================================================================
window.openContactMailModal = function (targetUserId, targetName) {
  const modal = document.getElementById("contact-mail-modal");
  const targetIdInput = document.getElementById("contactTargetId");
  const targetNameSpan = document.getElementById("contactModalTargetName");

  if (modal && targetIdInput && targetNameSpan) {
    targetIdInput.value = targetUserId;
    targetNameSpan.innerText = targetName;

    const subjectInput = modal.querySelector('input[name="subject"]');
    const messageTextarea = modal.querySelector('textarea[name="message"]');
    if (subjectInput) subjectInput.value = "";
    if (messageTextarea) messageTextarea.value = "";

    modal.style.display = "flex";
  }
};

window.submitContactEmail = async function (event) {
  event.preventDefault();

  const form = event.target;
  const modal = document.getElementById("contact-mail-modal");
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!form || !modal) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Wysyłanie...";
  }

  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");
  const formData = new URLSearchParams(new FormData(form)).toString();

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrfToken,
      },
      body: formData,
    });

    if (response.ok) {
      modal.style.display = "none";
      await window.Alert(
        "🎉 Twoja prywatna wiadomość e-mail została pomyślnie dostarczona na skrzynkę odbiorcy.",
        "Wiadomość wysłana",
      );
    } else {
      const errorText = await response.text();
      const errorMsg =
        errorText || "Odmowa dostępu lub błąd serwera pocztowego.";
      await window.Alert(
        `⚠️ Nie udało się wysłać wiadomości:<br><br><b>${errorMsg}</b>`,
        "Błąd wysyłki",
      );
    }
  } catch (err) {
    console.error("Błąd sieciowy wysyłania e-maila P2P:", err);
    await window.Alert(
      "Wystąpił krytyczny błąd połączenia z serwerem pocztowym.",
      "Błąd sieci",
    );
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = "Wyślij e-mail";
    }
  }
};

// public/js/profileApi.js

document.addEventListener("DOMContentLoaded", () => {
  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");

  // =========================================================================
  // PEŁNA ASYNCHRONICZNA AKTUALIZACJA OBSERWOWANIA (FOLLOW) BEZ RELOADU
  // =========================================================================
  const followForm = document.querySelector(".dynamic-follow-form");
  if (followForm) {
    followForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const button = followForm.querySelector(".profile-follow-btn");
      if (!button || !window.appUser) return;

      button.disabled = true;

      try {
        const response = await fetch(followForm.action, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "X-CSRF-Token": csrfToken,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            // 1. Zmień stan wizualny przycisku głównego
            button.innerText = data.isFollowing ? "Obserwujesz" : "Obserwuj";

            // 2. Pobierz referencje do elementów siatki społecznościowej
            const gridContainer = document.getElementById(
              "followers-grid-container",
            );
            const countBadge = document.getElementById("followers-count-badge");
            const fallbackText = document.getElementById(
              "no-followers-fallback-text",
            );

            if (gridContainer && countBadge) {
              let currentCount =
                parseInt(countBadge.getAttribute("data-count")) || 0;

              if (data.isFollowing) {
                // --- SCENARIUSZ A: DODANIE MNIE DO OBSERWUJĄCYCH ---
                currentCount += 1;

                if (fallbackText) fallbackText.remove();

                // Wykorzystujemy informacje lokalne z res.locals wstrzyknięte do okna window!
                const myProfileHtml = `
                  <a href="/profile/${window.appUser.id}" data-user-id="${window.appUser.id}" style="text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%;">
                    <img src="${window.appUser.avatarUrl}" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: #f0f2f5; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05);">
                    <span style="display: block; font-size: 12px; font-weight: 600; margin-top: 4px; line-height: 1.2; max-height: 2.4em; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; padding: 0 2px; width: 100%; word-break: break-word;">${window.appUser.displayName}</span>
                  </a>
                `;
                gridContainer.insertAdjacentHTML("beforeend", myProfileHtml);
              } else {
                // --- SCENARIUSZ B: COFNIĘCIE OBSERWOWANIA ---
                currentCount = Math.max(0, currentCount - 1);

                const myTile = gridContainer.querySelector(
                  `a[data-user-id="${window.appUser.id}"]`,
                );
                if (myTile) myTile.remove();

                if (
                  currentCount === 0 &&
                  !document.getElementById("no-followers-fallback-text")
                ) {
                  gridContainer.innerHTML = `<p id="no-followers-fallback-text" style="font-size: 13px; color: #65676b; text-align: center; margin: 10px 0; grid-column: span 3;">Tego użytkownika nikt jeszcze nie obserwuje.</p>`;
                }
              }

              // Aktualizacja licznika tekstowego oraz atrybutu danych
              countBadge.setAttribute("data-count", currentCount);
              countBadge.innerText = `${currentCount} osób`;
            }
          }
        }
      } catch (err) {
        console.error("Błąd dynamicznego follow:", err);
      } finally {
        button.disabled = false;
      }
    });
  }
});

// =========================================================================
// 5. OBSŁUGA PROCEDURY RODO (PRAWO DO BYCIA ZAPOMNIANYM)
// =========================================================================
window.triggerDeleteAccountModal = function () {
  const modal = document.getElementById("rodo-delete-modal");
  const input = document.getElementById("rodoConfirmEmailField");
  const error = document.getElementById("rodoModalError");

  if (modal && input) {
    input.value = "";
    if (error) error.style.display = "none";
    modal.style.display = "flex";
    input.focus();
  }
};
window.executeAccountErasure = async function (event) {
  event.preventDefault();

  const form = event.target;
  const inputField = document.getElementById("rodoConfirmEmailField");
  const errorBlock = document.getElementById("rodoModalError");
  const expectedEmail = form.getAttribute("data-email").trim().toLowerCase();

  if (!inputField || inputField.value.trim().toLowerCase() !== expectedEmail) {
    if (errorBlock) errorBlock.style.display = "block";
    return;
  }

  if (errorBlock) errorBlock.style.display = "none";

  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");
  const serializedBody = new URLSearchParams();
  serializedBody.set("confirmEmail", inputField.value.trim());

  try {
    const response = await fetch("/profile/settings/request-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrfToken,
      },
      body: serializedBody.toString(),
    });

    if (response.ok) {
      document.getElementById("rodo-delete-modal").style.display = "none";
      await window.Alert(
        "✉️ <strong>Link bezpieczeństwa został wysłany!</strong><br><br>Na Twój adres e-mail przesłaliśmy instrukcję weryfikacyjną. Otwórz swoją skrzętkę pocztową i kliknij w bezpieczny odnośnik, aby trwale sfinalizować usunięcie konta.",
        "Autoryzacja RODO",
      );
    } else {
      const errText = await response.text();
      await window.Alert(`Błąd operacji: ${errText}`);
    }
  } catch (err) {
    console.error(
      "Błąd połączenia sieciowego podczas żądania usuwania konta:",
      err,
    );
  }
};
