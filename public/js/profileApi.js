if (window.Alert === undefined) window.Alert = window.alert;

// =========================================================================
// ZINTEGROWANY MODUŁ RELACJI SPOŁECZNOŚCIOWYCH (FOLLOW ORAZ BLOCK)
// =========================================================================

/**
 * Uniwersalny pomocnik aktualizujący atrybuty wizualne, tekstowe i dostępnościowe (RWD/Mobile)
 */
function updateButtonState(button, isActive, config) {
  if (!button) return;

  const textEl = button.querySelector(".btn-text");
  const iconEl = button.querySelector("i");
  const currentState = isActive ? config.active : config.inactive;

  // 1. Aktualizacja tekstów (widoczna na desktopie)
  if (textEl) {
    textEl.innerText = currentState.text;
  }

  // 2. Aktualizacja ikon FontAwesome (widoczna na desktopie i mobile)
  if (iconEl) {
    iconEl.className = currentState.icon;
  }

  // 3. Krytyczna aktualizacja dla mobile i czytników ekranowych: title i aria-label
  button.setAttribute("title", currentState.title);
  button.setAttribute("aria-label", currentState.title);

  // 4. Aktualizacja klas CSS kontrastujących kolory w arkuszach stylów
  if (isActive) {
    button.classList.add(config.className);
  } else {
    button.classList.remove(config.className);
  }
}

/**
 * Zintegrowana obsługa asynchronicznego obserwowania profilu (Follow)
 */
async function handleAsyncFollowUserSubmit(form, csrfToken) {
  if (form.dataset.loading === "true") return;
  form.dataset.loading = "true";

  const button = form.querySelector(".profile-follow-btn");
  if (button) button.disabled = true;

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        const followConfig = {
          className: "is-following",
          active: {
            text: "Obserwujesz",
            icon: "fa-solid fa-eye-slash",
            title: "Przestań obserwować",
          },
          inactive: {
            text: "Obserwuj",
            icon: "fa-solid fa-eye",
            title: "Obserwuj profil",
          },
        };

        updateButtonState(button, data.isFollowing, followConfig);

        // Aktualizacja dynamicznej siatki awatarów na sidebarze relacji
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
            currentCount += 1;
            if (fallbackText) fallbackText.remove();
            const myProfileHtml = `
              <a href="/profile/${window.appUser.id}" data-user-id="${window.appUser.id}" style="text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%;">
                <img src="${window.appUser.avatarUrl}" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: #f0f2f5; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05);">
                <span style="display: block; font-size: 12px; font-weight: 600; margin-top: 4px; line-height: 1.2; max-height: 2.4em; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; padding: 0 2px; width: 100%; word-break: break-word;">${window.appUser.displayName}</span>
              </a>
            `;
            gridContainer.insertAdjacentHTML("beforeend", myProfileHtml);
          } else {
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

          countBadge.setAttribute("data-count", currentCount);
          countBadge.innerText = `${currentCount} osób`;
        }
      }
    }
  } catch (err) {
    console.error("Błąd sieciowy podczas operacji follow:", err);
  } finally {
    form.dataset.loading = "false";
    if (button) {
      button.disabled = false;
      button.blur();
    }
  }
}

/**
 * Zintegrowana obsługa asynchronicznego blokowania profilu (Block)
 */
async function handleAsyncBlockUserSubmit(form, csrfToken) {
  if (form.dataset.loading === "true") return;
  form.dataset.loading = "true";

  const button = form.querySelector(".profile-block-main-btn");
  if (button) button.disabled = true;

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        // PEWNY SELEKTOR KLASY: Pobieramy przycisk poczty bezpośrednio po jego klasie zadeklarowanej w Pug
        const mailBtn = document.querySelector(".profile-mail-main-btn");
                        
        // Stabilny selektor dla przycisków polubienia (gwiazdek) pod postami
        const likeBtns = document.querySelectorAll(".post-like-form, .action-btn, .restricted-feature-trigger");

        const blockConfig = {
          className: "is-blocking",
          active: { text: "Odblokuj", icon: "fa-solid fa-user", title: "Odblokuj profil" },
          inactive: { text: "Zablokuj", icon: "fa-solid fa-user-slash", title: "Blokuj profil" }
        };

        updateButtonState(button, data.isBlocked, blockConfig);

        if (data.isBlocked) {
          // 1. Ukrywamy przycisk koperty e-mail z priorytetem w kaskadzie mobile/desktop
          if (mailBtn) {
            mailBtn.style.setProperty("display", "none", "important");
          }

          // 2. Ukrywamy wszystkie przyciski polubień (gwiazdek) pod postami autora na profilu
          if (likeBtns && likeBtns.length > 0) {
            likeBtns.forEach(btn => {
              if (btn.querySelector(".fa-star") || btn.classList.contains("post-like-form")) {
                btn.style.setProperty("display", "none", "important");
              }
            });
          }

          // 3. Kaskadowy auto-reset przycisku obserwowania do stanu podstawowego (fa-eye)
          const followBtn = document.querySelector(".profile-follow-btn");
          if (followBtn) {
            const followConfig = {
              className: "is-following",
              active: { text: "Obserwujesz", icon: "fa-solid fa-eye-slash", title: "Przestań obserwować" },
              inactive: { text: "Obserwuj", icon: "fa-solid fa-eye", title: "Obserwuj profil" }
            };
            updateButtonState(followBtn, false, followConfig);
          }

          // 4. Czyszczenie kafelka z siatki obserwujących
          if (window.appUser) {
            const gridContainer = document.getElementById("followers-grid-container");
            const countBadge = document.getElementById("followers-count-badge");

            if (gridContainer && countBadge) {
              const myTile = gridContainer.querySelector(`a[data-user-id="${window.appUser.id}"]`);
              if (myTile) {
                myTile.remove();
                let currentCount = parseInt(countBadge.getAttribute("data-count")) || 0;
                currentCount = Math.max(0, currentCount - 1);
                countBadge.setAttribute("data-count", currentCount);
                countBadge.innerText = `${currentCount} osób`;

                if (currentCount === 0 && !document.getElementById("no-followers-fallback-text")) {
                  gridContainer.innerHTML = `<p id="no-followers-fallback-text" style="font-size: 13px; color: #65676b; text-align: center; margin: 10px 0; grid-column: span 3;">Tego użytkownika nikt jeszcze nie obserwuje.</p>`;
                }
              }
            }
          }
        } else {
          // Przy odblokowaniu przywracamy przycisk poczty
          if (mailBtn) {
            mailBtn.style.setProperty("display", "inline-flex", "important");
          }

          // Przy odblokowaniu przywracamy przyciski polubień
          if (likeBtns && likeBtns.length > 0) {
            likeBtns.forEach(btn => {
              if (btn.querySelector(".fa-star") || btn.classList.contains("post-like-form")) {
                const defaultDisplay = btn.tagName.toLowerCase() === 'form' ? 'inline-block' : 'inline-flex';
                btn.style.setProperty("display", defaultDisplay, "important");
              }
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Błąd sieciowy podczas blokowania użytkownika:", err);
  } finally {
    form.dataset.loading = "false";
    if (button) {
      button.disabled = false;
      button.blur();
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");

  // =========================================================================
  // CENTRALNY DISPATCHER REJESTRACJI FORMULARZY PROFILU (DELEGACJA ZDARZEŃ)
  // =========================================================================
  document.addEventListener("submit", function (e) {
    const form = e.target;
    if (!form || !form.action) return;

    if (form.classList.contains("dynamic-follow-form")) {
      e.preventDefault();
      e.stopPropagation();
      handleAsyncFollowUserSubmit(form, csrfToken);
      return;
    }

    if (form.classList.contains("dynamic-block-form")) {
      e.preventDefault();
      e.stopPropagation();
      handleAsyncBlockUserSubmit(form, csrfToken);
      return;
    }
  });

  // =========================================================================
  // 1. SZYBKA AKTUALIZACJA BIO NA PROFILU (FETCH API)
  // =========================================================================
  const bioEditForm = document.getElementById("bio-edit-form");
  const bioTextContent = document.getElementById("bio-text-content");

  if (bioEditForm && bioTextContent) {
    bioEditForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();

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
                ? "Zapisano dane profilu! Na Twój nowo wprowadzony adres e-mail wysłaliśmy bezpieczny link aktywacyjny."
                : "Ustawienia Twojego konta zostały pomyślnie zaktualizowane";
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
        "Link bezpieczeństwa został wysłany! Na Twój adres e-mail przesłaliśmy instrukcję weryfikacyjną. Otwórz swoją skrzęte pocztową i kliknij w bezpieczny odnośnik, aby trwale sfinalizować usunięcie konta.",
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
