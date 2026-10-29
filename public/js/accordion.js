// public/js/accordion.js
// ==========================================
// INTERFEJS UŻYTKOWNIKA, AKORDEONY I MODALE GLOBALNE
// ==========================================

// public/js/accordion.js - CZĘŚĆ 1 (Zaktualizowana o resetowanie i czyszczenie)
function initAccordionListeners() {
  // 1. Dynamiczne dopasowywanie wysokości pola textarea komentarzy i przywracanie jej po wysłaniu
  const commentForms = document.querySelectorAll(".comment-submit-on-enter");
  commentForms.forEach((form) => {
    if (!form.dataset.listenerAttached) {
      const textarea = form.querySelector('textarea[name="content"]');
      if (textarea) {
        // Dynamiczne rośnięcie pola w miarę wpisywania tekstu
        textarea.addEventListener("input", function () {
          this.style.height = "auto";
          this.style.height = this.scrollHeight + "px";
        });

        // Pozostawiamy jedynie bezpieczny reset wysokości, czyszczenie tekstu przenosimy do api.js
        form.addEventListener("submit", function () {
          setTimeout(() => {
            textarea.style.height = "auto";
          }, 50);
        });
      }
      form.dataset.listenerAttached = true;
    }
  });

  // 2. Logika kliknięcia akordeonu (Otwieranie / Zamykanie)
  const headers = document.querySelectorAll(".accordion-header");
  headers.forEach((header) => {
    if (!header.dataset.listenerAttached) {
      header.addEventListener("click", function () {
        const currentItem = this.closest(".accordion-item");
        const currentContent = currentItem.querySelector(".accordion-content");
        const currentIcon = this.querySelector(".accordion-icon");
        const isOpen = currentContent.style.display === "block";

        document.querySelectorAll(".accordion-content").forEach((content) => {
          content.style.display = "none";
        });
        document.querySelectorAll(".accordion-icon").forEach((icon) => {
          if (icon) icon.style.transform = "rotate(0deg)";
        });

        if (!isOpen) {
          currentContent.style.display = "block";
          if (currentIcon) currentIcon.style.transform = "rotate(180deg)";
          currentItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
      header.dataset.listenerAttached = true;
    }
  });
}

// 3. Pogoń za kotwicą URL (Wersja utwardzona z opóźnionym renderowaniem scrolla)
function handleUrlHashAnchor() {
  if (!window.location.hash) return;
  const targetId = window.location.hash.replace("#", "");

  function chaseAnchor() {
    const targetElement = document.getElementById(targetId);

    // --- SEKCJA AUTOMATYCZNEGO OTWIERANIA KOMENTARZY (Oś czasu oraz Single Post) ---
    if (
      targetId.startsWith("post-") ||
      targetId.startsWith("discussion-") ||
      targetId.startsWith("comment-")
    ) {
      let postId = null;

      if (targetId.startsWith("post-")) {
        postId = targetId.replace("post-", "");
      } else {
        // Szukamy nadrzędnego kontenera komentarzy, w którym znajduje się element docelowy
        const wrapper = targetElement
          ? targetElement.closest('[id^="comments-wrapper-"]')
          : null;
        if (wrapper) {
          postId = wrapper.id.replace("comments-wrapper-", "");
        } else {
          // Fallback dla widoku single-post: pobieramy jedyny istniejący wrapper komentarzy na stronie
          const fallbackWrapper = document.querySelector(
            '[id^="comments-wrapper-"]',
          );
          if (fallbackWrapper)
            postId = fallbackWrapper.id.replace("comments-wrapper-", "");
        }
      }

      if (postId) {
        const commentsContainer = document.getElementById(
          `comments-wrapper-${postId}`,
        );
        if (commentsContainer) {
          // JAWNE WYMUSZENIE WIDOCZNOŚCI: Musi być block, zanim przeglądarka obliczy pozycję Y elementu!
          commentsContainer.style.display = "block";
        }
      }
    }

    // --- SEKCJA PRECYZYJNEGO SCROLLOWANIA DO ELEMENTU DOCELOWEGO ---
    // Używamy setTimeout (150ms), aby dać przeglądarce czas na wyrenderowanie bloku komentarzy [2]
    setTimeout(() => {
      const freshTargetElement = document.getElementById(targetId);
      if (!freshTargetElement) return;

      // Jeśli cel to główna karta posta na osi czasu, otwieramy jej akordeon i scrollujemy
      if (freshTargetElement.classList.contains("post-card")) {
        initAccordionListeners();
        const content = freshTargetElement.querySelector(".accordion-content");
        const icon = freshTargetElement.querySelector(".accordion-icon");

        if (content) {
          content.style.display = "block";
          if (icon) icon.style.transform = "rotate(180deg)";
        }
        freshTargetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        // public/js/accordion.js - Końcówka sekcji przewijania (linie 65-80)
      } else {
        // Jeśli cel to konkretny komentarz (widok osi czasu lub single post) – przewijamy precyzyjnie do niego
        freshTargetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        // Wizualne wyróżnienie komentarza (efekt podświetlenia po powrocie na stronę)
        if (targetId.startsWith("comment-")) {
          freshTargetElement.style.transition = "background-color 0.4s ease";
          const originalBg = freshTargetElement.style.backgroundColor;
          freshTargetElement.style.backgroundColor =
            "var(--color-bg-main, #f0f2f5)";
          freshTargetElement.style.padding = "8px";
          freshTargetElement.style.borderRadius = "8px";

          setTimeout(() => {
            freshTargetElement.style.backgroundColor = originalBg;
          }, 1500);
        }
      }
    }, 200); // Podniesione do 200ms - gwarantuje pełne wyrenderowanie drzewa DOM przed skokiem ekranu
  }

  // Uruchomienie śledzenia kotwicy po załadowaniu drzewa DOM
  setTimeout(chaseAnchor, 250);
}

// Bezpieczne przeniesienie odznaki do wnętrza stopki po jej wyrenderowaniu przez Google
const moveBadgeToFooter = () => {
  const badge = document.querySelector('.grecaptcha-badge');
  const footer = document.querySelector('.site-footer');
  
  if (badge && footer) {
    footer.appendChild(badge);
  } else {
    // Jeśli skrypt Google jeszcze się ładuje, ponów próbę za chwilę
    setTimeout(moveBadgeToFooter, 300);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initAccordionListeners();
  handleUrlHashAnchor();
   setTimeout(moveBadgeToFooter, 500);
});

window.refreshAccordionListeners = function () {
  initAccordionListeners();
};

function toggleCommentEdit(commentId) {
  const textBlock = document.getElementById(`comment-text-${commentId}`);
  const editBlock = document.getElementById(`comment-edit-block-${commentId}`);

  if (editBlock.style.display === "none") {
    editBlock.style.display = "block";
    textBlock.style.display = "none";

    // KRYTYCZNA POPRAWKA: Namierzamy nowy element textarea i dopasowujemy jego wysokość startową do tekstu
    const textarea = editBlock.querySelector('textarea[name="content"]');
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";

      // Dodatkowe dynamiczne nasłuchiwanie rośnięcia podczas poprawiania tekstu w locie
      if (!textarea.dataset.resizeAttached) {
        textarea.addEventListener("input", function () {
          this.style.height = "auto";
          this.style.height = this.scrollHeight + "px";
        });
        textarea.dataset.resizeAttached = true;
      }

      textarea.focus();
      // Ustawienie kursora na samym końcu tekstu dla wygody edycji
      const val = textarea.value;
      textarea.value = "";
      textarea.value = val;
    }
  } else {
    editBlock.style.display = "none";
    textBlock.style.display = "block";
  }
}

function insertMention(postId, authorDisplayName) {
  const inputField = document.getElementById(`comment-input-field-${postId}`);
  if (inputField) {
    // Czyścimy ewentualne białe znaki z nazwy autora
    const cleanName = authorDisplayName.trim();
    inputField.value = `@${cleanName} ` + inputField.value;
    inputField.focus();
  }
}

// Obsługa menu dropdown w navbarze
document.addEventListener("DOMContentLoaded", () => {
  const dropdownBtn = document.getElementById("navDropdownBtn");
  const dropdownContent = document.getElementById("navDropdownContent");

  if (dropdownBtn && dropdownContent) {
    dropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownContent.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!dropdownContent.contains(e.target) && e.target !== dropdownBtn) {
        dropdownContent.classList.remove("show");
      }
    });
  }
});

// ==========================================
// 3. GLOBALNE ZAMIENNIKI SYSTEMOWYCH MODALI
// ==========================================

window.Alert = function (message, title = "Info") {
  return new Promise((resolve) => {
    const modal = document.getElementById("custom-alert-modal");
    const titleEl = document.getElementById("custom-alert-title");
    const messageEl = document.getElementById("custom-alert-message");
    const closeBtn = document.getElementById("custom-alert-close-btn");

    if (!modal || !titleEl || !messageEl || !closeBtn) {
      alert(message);
      return resolve();
    }

    titleEl.innerText = title;
    messageEl.innerHTML = message;
    modal.style.display = "flex";

    function handleClose() {
      modal.style.display = "none";
      closeBtn.removeEventListener("click", handleClose);
      resolve();
    }

    closeBtn.addEventListener("click", handleClose);
  });
};

window.Confirm = function (message, title = "Potwierdź") {
  return new Promise((resolve) => {
    const modal = document.getElementById("custom-confirm-modal");
    const titleEl = document.getElementById("custom-confirm-title");
    const messageEl = document.getElementById("custom-confirm-message");
    const successBtn = document.getElementById("custom-confirm-success-btn");
    const cancelBtn = document.getElementById("custom-confirm-cancel-btn");

    if (!modal || !titleEl || !messageEl || !successBtn || !cancelBtn) {
      const res = confirm(message);
      return resolve(res);
    }

    titleEl.innerText = title;
    messageEl.innerText = message;
    modal.style.display = "flex";

    function cleanupListeners() {
      successBtn.removeEventListener("click", handleSuccess);
      cancelBtn.removeEventListener("click", handleCancel);
    }

    function handleSuccess() {
      modal.style.display = "none";
      cleanupListeners();
      resolve(true);
    }

    function handleCancel() {
      modal.style.display = "none";
      cleanupListeners();
      resolve(false);
    }

    successBtn.addEventListener("click", handleSuccess);
    cancelBtn.addEventListener("click", handleCancel);
  });
};

document.addEventListener("click", function (e) {
  // Jeśli użytkownik kliknął w link wewnątrz naszego customowego okna alertu
  if (
    e.target &&
    e.target.closest("#custom-alert-modal") &&
    e.target.tagName === "A"
  ) {
    const modal = document.getElementById("custom-alert-modal");
    if (modal) {
      modal.style.display = "none"; // Natychmiast zamykamy tło modalne
    }
  }
});

window.toggleCommentsVisibility = function (postId) {
  const commentsContainer = document.getElementById(
    `comments-wrapper-${postId}`,
  );
  if (!commentsContainer) return;

  const currentDisplay = window.getComputedStyle(commentsContainer).display;

  if (currentDisplay === "none") {
    commentsContainer.style.display = "block";

    setTimeout(() => {
      const discussionHeading = document.getElementById(
        `discussion-heading-${postId}`,
      );
      if (discussionHeading) {
        // Precyzyjne i bezpieczne przewinięcie uwzględniające stałą wysokość navbaru (56px)
        const yOffset = -80;
        const yPosition =
          discussionHeading.getBoundingClientRect().top +
          window.pageYOffset +
          yOffset;

        window.scrollTo({
          top: yPosition,
          behavior: "smooth",
        });

        const inputField = document.getElementById(
          `comment-input-field-${postId}`,
        );
        if (inputField) inputField.focus();
      }
    }, 80);
  } else {
    commentsContainer.style.display = "none";
  }
};

// public/js/accordion.js

// ==========================================
// 5. OBSŁUGA GLOBALNEGO MODALU ZDJĘĆ (LIGHTBOX)
// ==========================================

window.openLightbox = function (imageSrc) {
  const modal = document.getElementById("custom-lightbox-modal");
  const targetImg = document.getElementById("lightbox-target-image");

  if (modal && targetImg) {
    targetImg.src = imageSrc;
    modal.style.display = "flex";
    document.body.style.overflow = "hidden"; // Blokada przewijania osi czasu w tle
  }
};

window.closeLightbox = function () {
  const modal = document.getElementById("custom-lightbox-modal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = ""; // Przywrócenie przewijania strony
  }
};

// Globalny nasłuchiwanie kliknięć z priorytetową blokadą mechanizmu akordeonu
document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener(
    "click",
    function (e) {
      // Detekcja kliknięcia w zdjęcie na osi czasu
      if (e.target && e.target.classList.contains("post-media")) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Bezwzględne odcięcie akordeonu przed wykonaniem toggle
        window.openLightbox(e.target.src);
        return;
      }

      // Detekcja kliknięcia w zdjęcie w widoku pojedynczego artykułu
      const articleImg = e.target.closest(".article-featured-image img");
      if (articleImg) {
        e.preventDefault();
        window.openLightbox(articleImg.src);
        return;
      }
    },
    true,
  ); // Użycie fazy przechwytywania (capture) dla gwarancji pierwszeństwa przed akordeonem

  // Obsługa zamknięcia klawiszem Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      window.closeLightbox();
    }
  });
});

// public/js/accordion.js -> Dodaj na końcu pliku

document.addEventListener("DOMContentLoaded", () => {
  // Globalny mechanizm przechwytywania kliknięć w zablokowane funkcje (Edukacja użytkownika)
  document.body.addEventListener(
    "click",
    function (e) {
      const trigger = e.target.closest(".restricted-feature-trigger");
      if (!trigger) return;

      // Blokujemy domyślne akcje i propagację akordeonów
      e.preventDefault();
      e.stopPropagation();

      const reason = trigger.getAttribute("data-reason");
      let title = "🛡️ Funkcja Ograniczona";
      let message =
        "Dostęp do tej funkcjonalności został tymczasowo wstrzymany.";

      // Centralny słownik komunikatów edukacyjnych dla użytkownika
      if (reason === "like_public") {
        title = "🔐 Wymagana Pełna Weryfikacja Konta";
        message = `
                <div style="text-align: left; line-height: 1.5;">
                    <p style="margin-bottom: 10px;">Chcesz polubić ten post publiczny? W trosce o autentyczność dyskusji i ochronę przed farmami botów, <b>polubienia postów i komentarzy publicznych wymagają pełnego statusu konta</b>.</p>
                    <p style="margin-bottom: 12px;">Aktualnie Twój profil nie przeszedł drugiego etapu weryfikacji tożsamości (przelew uwierzytelniający).</p>
                    <hr style="border:0; border-top:1px solid #e4e6eb; margin: 10px 0;">
                    <p style="font-size: 13px; color: #65676b;">💡 <b>Rozwiązanie:</b> Przejdź do Centrum Weryfikacji, aby zrealizować zwrotny przelew na kwotę 1.00 PLN i odblokować pełne możliwości platformy.</p>
                    <p style="margin-top: 14px; text-align: center;"><a href="/verify" style="display: inline-block; background: #1877f2; color: white; padding: 8px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Ukończ weryfikację konta</a></p>
                </div>
            `;
      } else if (reason === "comment_public") {
        title = "💬 Zablokowane Komentowanie Publiczne";
        message = `
                <div style="text-align: left; line-height: 1.5;">
                    <p style="margin-bottom: 10px;">Dodawanie komentarzy pod wpisami oznaczonymi jako <b>🌐 Publiczne</b> zostało ograniczone ze względów bezpieczeństwa społeczności.</p>
                    <p style="margin-bottom: 12px;">Aby dołączyć do tej dyskusji i publikować komentarze widoczne dla wszystkich, Twój profil musi posiadać zweryfikowaną tożsamość fizyczną.</p>
                    <hr style="border:0; border-top:1px solid #e4e6eb; margin: 10px 0;">
                    <p style="font-size: 13px; color: #65676b;">🔒 Środki te minimalizują zjawisko spamu, mowy nienawiści oraz nieautoryzowanych reklam na platformie.</p>
                    <p style="margin-top: 14px; text-align: center;"><a href="/verify" style="display: inline-block; background: #1877f2; color: white; padding: 8px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Przejdź do weryfikacji konta</a></p>
                </div>
            `;
      } else if (reason === "like_comment") {
        title = "🔐 Wymagana Weryfikacja Interakcji";
        message = `
                <div style="text-align: left; line-height: 1.5;">
                    <p style="margin-bottom: 10px;">Reagowanie i przyznawanie punktów polubień dla wypowiedzi w sekcjach publicznych zostało zablokowane.</p>
                    <p style="margin-bottom: 12px;">Aby zapobiegać sztucznemu manipulowaniu pozycją komentarzy przez boty, <b>oddawanie głosów pod wpisami publicznymi wymaga pełnego statusu konta</b>.</p>
                    <hr style="border:0; border-top:1px solid #e4e6eb; margin: 10px 0;">
                    <p style="font-size: 13px; color: #65676b;">💡 Wykonaj jednorazowy przelew uwierzytelniający (1.00 PLN) w panelu weryfikacji, aby trwale odblokować pełną aktywność społecznościową.</p>
                    <p style="margin-top: 14px; text-align: center;"><a href="/verify" style="display: inline-block; background: #1877f2; color: white; padding: 8px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Przejdź do Centrum Weryfikacji</a></p>
                </div>
            `;
      }
      // Wywołujemy zintegrowane w aplikację estetyczne okno Alert Modal
      if (typeof window.Alert === "function") {
        window.Alert(message, title);
      } else {
        alert(title + "\n\n" + message.replace(/<\/?[^>]+(>|\$)/g, ""));
      }
    },
    true,
  ); // Używamy fazy przechwytywania (capture), by mieć absolutne pierwszeństwo przed mechanizmami akordeonu
});

document.addEventListener("DOMContentLoaded", () => {
  const bindPasswordToggle = (iconId, inputId) => {
    const icon = document.getElementById(iconId);
    const input = document.getElementById(inputId);
    if (icon && input) {
      icon.addEventListener("click", () => {
        if (input.type === "password") {
          input.type = "text";
          icon.classList.replace("fa-eye", "fa-eye-slash");
        } else {
          input.type = "password";
          icon.classList.replace("fa-eye-slash", "fa-eye");
        }
      });
    }
  };
  bindPasswordToggle("toggleLoginPassword", "loginPasswordField");
  bindPasswordToggle("toggleResetPassword", "resetPasswordField");
  bindPasswordToggle("toggleConfirmPassword", "confirmPasswordField");
});
// public/js/accordion.js -> Obsługa zwijanego panelu zgłoszeń nadużyć na stronie artykułu

window.toggleAbuseReportsVisibility = function () {
  const wrapper = document.getElementById("abuse-reports-wrapper");
  const icon = document.getElementById("abuse-accordion-icon");

  if (!wrapper || !icon) return;

  // Sprawdzamy obecny stan widoczności wyliczony przez przeglądarkę
  const isHidden =
    window.getComputedStyle(wrapper).display === "none" ||
    wrapper.style.display === "none";

  if (isHidden) {
    wrapper.style.display = "block";
    icon.style.transform = "rotate(180deg)"; // Obrót strzałki do góry
  } else {
    wrapper.style.display = "none";
    icon.style.transform = "rotate(0deg)"; // Powrót strzałki do pozycji wyjściowej
  }
};

// =========================================================================
// OBSŁUGA BANNERU COOKIES (ePRIVACY DIRECTIVE)
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  const cookieBanner = document.getElementById("cookie-law-banner");
  if (cookieBanner) {
    // Sprawdzamy, czy użytkownik już wcześniej zamknął powiadomienie
    const isCookieAccepted = localStorage.getItem("cookie_law_accepted");
    if (!isCookieAccepted) {
      cookieBanner.style.display = "block"; // Pokazujemy banner
    }
  }
});

window.acceptCookieLaw = function () {
  const cookieBanner = document.getElementById("cookie-law-banner");
  if (cookieBanner) {
    cookieBanner.style.display = "none"; // Ukrywamy banner
    localStorage.setItem("cookie_law_accepted", "true"); // Zapamiętujemy decyzję
  }
};
