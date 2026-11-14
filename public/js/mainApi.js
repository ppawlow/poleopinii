if (window.Alert === undefined) window.Alert = window.alert;

function liczebnik(liczba, forma) {
  if (liczba == 1) return liczba + " " + forma[0];
  if (liczba > 4 && liczba < 22) return liczba + " " + forma[2];
  wskaznik = liczba % 10;
  if (wskaznik > 1 && wskaznik < 5) return liczba + " " + forma[1];
  else return liczba + " " + forma[2];
}

document.addEventListener("DOMContentLoaded", () => {
  const searchForm = document.querySelector('form[action="/search"]');
  const searchInput = document.querySelector('input[name="q"]');
  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const queryValue = searchInput.value.trim();
      const wrapper =
        document.querySelector(".accordion-container") ||
        document.querySelector("main.feed");

      // Warunek walidacji: minimum 3 znaki
      if (queryValue.length < 3) {
        if (typeof window.Alert === "function") {
          window.Alert(
            "Fraza wyszukiwania musi składać się z co najmniej 3 znaków.",
            "Wyszukiwanie",
          );
        }
        return;
      }

      try {
        const response = await fetch(
          `/search/api?q=${encodeURIComponent(queryValue)}`,
        );
        if (response.ok) {
          const data = await response.json();
          wrapper.innerHTML = data.html;
          if (window.refreshAccordionListeners)
            window.refreshAccordionListeners();
        }
      } catch (err) {
        console.error(err);
      }
    });
  }
});

/**
 * Zoptymalizowana obsługa asynchronicznego dodawania komentarzy (Zgodna z nową strukturą renderPartial)
 */
async function handleAsyncCommentSubmit(form, csrfToken) {
  const inputField = form.querySelector('textarea[name="content"]');
  if (!inputField || inputField.value.trim().length === 0) return;

  if (form.dataset.loading === "true") return;
  form.dataset.loading = "true";

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  let postId = "";
  try {
    const urlObj = new URL(form.action, window.location.origin);
    const pathParts = urlObj.pathname.split("/");
    const postsIndex = pathParts.indexOf("posts");
    if (postsIndex !== -1 && pathParts[postsIndex + 1]) {
      postId = pathParts[postsIndex + 1];
    }
  } catch (urlErr) {
    const actionParts = form.action.split("/");
    postId = actionParts[actionParts.indexOf("posts") + 1] || actionParts;
  }

  const formData = new URLSearchParams(new FormData(form)).toString();

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.html) {
        const postCard = form.closest(".post-card, .editorial-article");
        const commentsWrapper = document.getElementById(`comments-wrapper-${postId}`);

        if (postCard && commentsWrapper) {
          // Namierzamy nadrzędny kontener dyskusji (zdefiniowany w post-footer.pug)
          const targetBlock = commentsWrapper.querySelector(".article-comments-block");
          
          if (targetBlock) {
            // 1. Płynnie podmieniamy całą zawartość sekcji (komentarze + nagłówek + nowy formularz)
            targetBlock.innerHTML = data.html;
            
            // 2. KRYTYCZNA POPRAWKA: Re-inicjalizujemy słuchacze zdarzeń, aby nowo wstrzyknięte pole tekstowe 
            // natychmiast zarejestrowało nasłuchiwanie zdarzeń (auto-resize oraz wysyłkę na klawisz Enter)
            if (typeof window.refreshAccordionListeners === "function") {
              window.refreshAccordionListeners();
            }

            // 3. Pobieramy nowo wygenerowane pole tekstowe z dolnej części nowej struktury DOM
            const freshInputField = targetBlock.querySelector(`#comment-input-field-${postId}`);
            if (freshInputField) {
              freshInputField.value = ""; // Bezwzględne wyczyszczenie wpisanej treści
              freshInputField.style.height = "36px"; // Przywrócenie domyślnej, startowej wysokości pola
              freshInputField.focus(); // Ponowne osadzenie kursora dla zachowania płynności mikro-UX
            }
          }

          // Wyliczamy aktualny stan liczników na podstawie nowo wstrzykniętych kart `.comment-card`
          const freshCommentsCount = commentsWrapper.querySelectorAll(".comment-card").length;

          // Aktualizacja dolnego paska statystyk na karcie głównej artykułu
          const commentsCountEl = document.getElementById(`comments-text-${postId}`);
          if (commentsCountEl && typeof liczebnik === "function") {
            commentsCountEl.innerHTML = liczebnik(freshCommentsCount, [
              "komentarz",
              "komentarze",
              "komentarzy",
            ]);
          }

          // Aktualizacja wewnętrznego nagłówka h3 rozwijanej sekcji dyskusyjnej
          const discussionHeadingEl = document.getElementById(`discussion-heading-${postId}`);
          if (discussionHeadingEl) {
            discussionHeadingEl.innerHTML = `Dyskusja (${freshCommentsCount})`;
          }
        }
      }
    }
  } catch (err) {
    console.error("Błąd podczas asynchronicznego dodawania komentarza przez AJAX:", err);
  } finally {
    form.dataset.loading = "false";
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Obsługa asynchronicznego oceniania postów (klasa .post-like-form)
 */
async function handleAsyncPostLikeSubmit(form, csrfToken) {
  if (form.dataset.loading === "true") return;
  form.dataset.loading = "true";

  const button = form.querySelector("button");
  if (button) {
    button.disabled = true;
    button.style.opacity = "0.6";
  }

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
      const likeTextEl = form.querySelector(".like-text");
      const iconEl = form.querySelector("i");

      if (data.success) {
        if (likeTextEl) likeTextEl.innerText = data.liked ? "Cofnij" : "Doceń";
        if (iconEl) {
          iconEl.className = data.liked
            ? "fa-solid fa-star"
            : "fa-regular fa-star";
        }

        const postCard = form.closest(".post-card, .editorial-article");
        if (postCard) {
          // Dynamiczna aktualizacja licznika lajków na profilu lub osi czasu (ID dodane w post-footer.pug)
          const postId = form.action.split("/")[2];
          const dynamicLikesEl = document.getElementById(
            `likes-text-${postId}`,
          );

          if (dynamicLikesEl) {
            dynamicLikesEl.innerHTML = liczebnik(data.likesCount, [
              "polubienie",
              "polubienia",
              "polubień",
            ]);
          } else {
            // Fallback dla widoku statycznego w starszych strukturach DOM
            const likesCountEl = postCard.querySelector(".likes-count");
            if (likesCountEl) {
              likesCountEl.innerHTML = liczebnik(data.likesCount, [
                "polubienie",
                "polubienia",
                "polubień",
              ]);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Błąd sieciowy podczas lajkowania wpisu:", err);
  } finally {
    form.dataset.loading = "false";
    if (button) {
      button.disabled = false;
      button.style.opacity = "";
      button.blur();
    }
  }
}

/**
 * Obsługa asynchronicznego blokowania profilu (klasa .dynamic-block-form)
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
        const btnTextSpan = button.querySelector(".btn-text");
        const iconEl = button.querySelector("i");
        const mailBtn = document.querySelector(".profile-mail-main-btn");

        if (btnTextSpan) {
          btnTextSpan.innerText = data.isBlocked ? "Odblokuj" : "Zablokuj";
        }

        // AKTUALIZACJA IKONY ORAZ ATRYBUTU TITLE DLA BLOKADY
        if (iconEl) {
          if (data.isBlocked) {
            iconEl.className = "fa-solid fa-user";
            button.setAttribute("title", "Odblokuj profil");
          } else {
            iconEl.className = "fa-solid fa-user-slash";
            button.setAttribute("title", "Blokuj profil");
          }
        }

        if (data.isBlocked) {
          button.classList.add("is-blocking");

          if (mailBtn) {
            mailBtn.style.display = "none";
          }

          // Reset przycisku obserwowania oraz jego title przy aktywacji blokady
          const followBtn = document.querySelector(".profile-follow-btn");
          if (followBtn) {
            followBtn.classList.remove("is-following");
            const followText = followBtn.querySelector(".btn-text");
            const followIcon = followBtn.querySelector("i");
            if (followText) followText.innerText = "Obserwuj";
            if (followIcon) {
              followIcon.className = "fa-solid fa-eye";
            }
            followBtn.setAttribute("title", "Obserwuj profil");
          }
          if (window.appUser) {
            const gridContainer = document.getElementById(
              "followers-grid-container",
            );
            const countBadge = document.getElementById("followers-count-badge");

            if (gridContainer && countBadge) {
              const myTile = gridContainer.querySelector(
                `a[data-user-id="${window.appUser.id}"]`,
              );
              if (myTile) {
                myTile.remove();
                let currentCount =
                  parseInt(countBadge.getAttribute("data-count")) || 0;
                currentCount = Math.max(0, currentCount - 1);
                countBadge.setAttribute("data-count", currentCount);
                countBadge.innerText = `${currentCount} osób`;

                if (
                  currentCount === 0 &&
                  !document.getElementById("no-followers-fallback-text")
                ) {
                  gridContainer.innerHTML = `<p id="no-followers-fallback-text" style="font-size: 13px; color: #65676b; text-align: center; margin: 10px 0; grid-column: span 3;">Tego użytkownika nikt jeszcze nie obserwuje.</p>`;
                }
              }
            }
          }
        } else {
          button.classList.remove("is-blocking");

          // Dynamiczne przywrócenie przycisku poczty na frontendzie po odblokowaniu
          if (mailBtn) {
            mailBtn.style.display = "inline-flex";
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

/**
 * Obsługa bezpiecznego usuwania zasobów (akcje zawierające endpoint /delete)
 */
/**
 * Obsługa bezpiecznego usuwania zasobów (zarówno postów, jak i komentarzy) przez AJAX
 */
async function handleAsyncDeleteSubmit(form, csrfToken) {
  const confirmMsg =
    form.getAttribute("data-confirm") ||
    "Czy na pewno chcesz usunąć ten zasób?";

  if (typeof window.Confirm === "function") {
    if (!(await window.Confirm(confirmMsg))) return;
  } else {
    if (!confirm(confirmMsg)) return;
  }

  if (form.dataset.loading === "true") return;
  form.dataset.loading = "true";

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    });

    if (response.ok) {
      // Znajduje najbliższą kartę komentarza (.comment-card) lub posta (.post-card)
      const targetCard = form.closest(".comment-card, .post-card");
      const postCard = form.closest(".post-card, .editorial-article");
      const isComment = targetCard && targetCard.classList.contains("comment-card");

      if (targetCard) {
        // Płynna animacja znikania z elementu z widoku (UX)
        targetCard.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        targetCard.style.opacity = "0";
        targetCard.style.transform = "scale(0.98)";
        
        setTimeout(() => {
          targetCard.remove();

          // Jeśli usunięto komentarz, dynamicznie aktualizujemy liczniki bez przeładowania strony
          if (isComment && postCard) {
            let postId = "";
            const actionParts = form.action.split("/");
            const postsIndex = actionParts.indexOf("posts");
            if (postsIndex !== -1 && actionParts[postsIndex + 1]) {
              postId = actionParts[postsIndex + 1];
            }

            const freshCommentsCount = postCard.querySelectorAll(".comment-card").length;

            // Aktualizacja licznika w stopce posta (np. "3 komentarze")
            const commentsCountEl = document.getElementById(`comments-text-${postId}`);
            if (commentsCountEl && typeof liczebnik === "function") {
              commentsCountEl.innerHTML = liczebnik(freshCommentsCount, ["komentarz", "komentarze", "komentarzy"]);
            }

            // Aktualizacja nagłówka sekcji komentarzy (Dyskusja (3))
            const discussionHeadingEl = document.getElementById(`discussion-heading-${postId}`);
            if (discussionHeadingEl) {
              discussionHeadingEl.innerHTML = `Dyskusja (${freshCommentsCount})`;
            }

            // Jeśli to był ostatni komentarz, wstrzyknij informację o braku komentarzy
            const commentsListContainer = document.getElementById(`comments-list-${postId}`);
            if (freshCommentsCount === 0 && commentsListContainer) {
              commentsListContainer.insertAdjacentHTML(
                "afterbegin",
                `<div class="no-comments-placeholder" id="no-comments-notice-${postId}" style="font-size: 13px; color: #65676b; font-style: italic; padding: 8px 12px; margin-bottom: 12px;">💬 Brak komentarzy. Rozpocznij dyskusję jako pierwszy!</div>`
              );
            }
          }
        }, 200);
      }
    } else {
      const errText = await response.text();
      if (typeof window.Alert === "function") {
        window.Alert(`Nie udało się usunąć: ${errText}`, "Błąd systemu");
      }
    }
  } catch (err) {
    console.error("Błąd sieciowy podczas usuwania zasobu:", err);
  } finally {
    form.dataset.loading = "false";
  }
}

/**
 * Obsługa asynchronicznej reedycji komentarza (.comment-edit-form)
 */
async function handleAsyncCommentEditSubmit(form, csrfToken) {
  const textarea = form.querySelector('textarea[name="content"]');
  if (!textarea || textarea.value.trim().length === 0) return;

  if (form.dataset.loading === "true") return;
  form.dataset.loading = "true";

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "...";
  }

  const formData = new URLSearchParams(new FormData(form)).toString();

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        // Wyciągamy ID komentarza z sekcji ID nadrzędnego bloku edycji
        const editBlock = form.closest(".comment-edit-form-block");
        const commentId = editBlock.id.replace("comment-edit-block-", "");

        const textBlock = document.getElementById(`comment-text-${commentId}`);

        if (textBlock) {
          // 1. Aktualizujemy treść w locie nowym oczyszczonym tekstem z serwera
          textBlock.innerText = data.content;

          // 2. Przywracamy tryb widoku (chowamy edytor, pokazujemy zaktualizowany tekst)
          editBlock.style.display = "none";
          textBlock.style.display = "block";
        }
      }
    } else {
      const errText = await response.text();
      if (typeof window.Alert === "function") {
        window.Alert(errText, "Błąd edycji");
      }
    }
  } catch (err) {
    console.error("Błąd sieciowy edycji komentarza:", err);
  } finally {
    form.dataset.loading = "false";
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = "Zapisz";
    }
  }
}

// public/js/mainApi.js -> Zaktualizowany blok dispatchera na samym dole pliku

// =========================================================================
// CENTRALNY DISPATCHER STRUMIENIA ZDARZEŃ FORMULARZY
// =========================================================================

document.addEventListener("submit", function (e) {
  const form = e.target;
  if (!form || !form.action) return;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  // 1. Reedycja i zapis zmian komentarza
  if (form.classList.contains("comment-edit-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncCommentEditSubmit(form, csrfToken);
    return;
  }

  // 2. Lajkowanie komentarza
  if (form.classList.contains("comment-like-form") || form.action.includes("/comments/") && form.action.includes("/like")) {
    e.preventDefault();
    e.stopPropagation();
    // Przekierowujemy bezpośrednio do wbudowanego mechanizmu, który obsłuży to bez przeładowania
    fetch(form.action, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken, "X-Requested-With": "XMLHttpRequest" }
    }).then(() => window.location.reload()); // Najprostszy, stabilny przeładunek dbający o spójność stanów
    return;
  }

  // 3. Dodawanie nowego komentarza (Ignoruje ścieżki reedycji i lajków)
  if (form.classList.contains("comment-form") || (form.action.includes("/comment") && !form.action.includes("/comments/"))) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncCommentSubmit(form, csrfToken);
    return;
  }

  // 4. Polubienie posta głównego (post-card)
  if (form.classList.contains("post-like-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncPostLikeSubmit(form, csrfToken);
    return;
  }

  // 5. Blokowanie użytkownika
  if (form.classList.contains("dynamic-block-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncBlockUserSubmit(form, csrfToken);
    return;
  }

  // 6. Usuwanie zasobów (Zunifikowana asynchroniczna kaskada dla postów oraz komentarzy)
  if (form.action.includes("/delete")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncDeleteSubmit(form, csrfToken);
    return;
  }
});


window.closeShareModal = function () {
  const modal = document.getElementById("custom-share-modal");
  if (modal) modal.style.display = "none";
};

window.copyShareLinkToClipboard = function () {
  const copyInput = document.getElementById("share-copy-input");
  if (copyInput) {
    copyInput.select();
    copyInput.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyInput.value).then(() => {
      window.Alert("Link skopiowany do schowka!", "System");
      window.closeShareModal();
    });
  }
};

window.sharePost = async function (postId, postTitle) {
  const shareUrl = `${window.location.origin}/posts/${postId}`;
  const decoder = document.createElement("div");
  decoder.innerHTML = postTitle;
  const cleanTitle = decoder.textContent || "Wpis";
  
  console.log(`Udostępnianie: ${shareUrl}`);
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: cleanTitle,
        text: `Sprawdź artykuł na platformie: "${cleanTitle}"`,
        url: shareUrl,
      });
      return;
    } catch (err) {
      if (err.name !== "AbortError") {
        console.warn(
          "Systemowe udostępnianie zgłosiło błąd, uruchamiam fallback modal:",
          err,
        );
      } else {
        return;
      }
    }
  }

  const modal = document.getElementById("custom-share-modal");
  const copyInput = document.getElementById("share-copy-input");

  if (modal && copyInput) {
    copyInput.value = shareUrl;
    const popupFeatures =
      "width=600,height=450,resizable=yes,scrollbars=yes,status=no";

    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedTitle = encodeURIComponent(cleanTitle);

    modal.querySelectorAll(".share-platform-btn").forEach((btn) => {
      const template = btn.getAttribute("data-url-template");
      if (!template) return;

      btn.onclick = function () {
        const targetUrl = template
          .replace(/\{url\}/g, encodedUrl)
          .replace(/\{title\}/g, encodedTitle);
        window.open(targetUrl, "_blank", popupFeatures);
      };
    });

    modal.style.display = "flex";
  }
};

/**
 * Osłona anty-kosztowa przed przypadkowym uruchomieniem audytu AI przez Czytelnika
 */
window.executeReaderFactCheckWithConfirm = async function (postId, buttonElement) {
  if (!postId || !buttonElement) return;

  const message = "Czy chcesz uruchomić zaawansowaną weryfikację faktograficzną dla tego wpisu? Algorytm Gemini przeszuka sieć za pomocą Google Search Grounding i opublikuje oficjalny raport w sekcji Polemik pod tym artykułem. Tę akcję można wykonać tylko raz.";
  
  const confirmed = typeof window.Confirm === "function"
    ? await window.Confirm(message, "Uruchomić Fact-Checking AI?")
    : confirm(message);

  if (!confirmed) return;

  window.executeReaderFactCheckPayload(postId, buttonElement);
};

/**
 * Asynchroniczne wywołanie publicznej analityki tekstu
 */
window.executeReaderFactCheckPayload = async function (postId, buttonElement) {
  const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  
  // Pobieramy instancję modalu ładowania z szablonu modal.pug
  const loadingModal = document.getElementById("custom-loading-modal");
  const loaderHeading = document.getElementById("loader-status-heading");
  const loaderText = document.getElementById("loader-status-text");

  if (loadingModal) {
    if (loaderHeading) loaderHeading.innerText = "🤖 Trwa Fact-Checking AI w czasie rzeczywistym...";
    if (loaderText) loaderText.innerText = "System analizuje artykuł, mapuje kluczowe tezy oraz weryfikuje dane faktograficzne w chmurze informacyjnej Google. Proszę czekać, to może potrwać około 15-30 sekund.";
    loadingModal.style.display = "flex";
  }

  // Blokada przycisku przed double-tap
  buttonElement.disabled = true;

  try {
    const response = await fetch(`/posts/${postId}/factcheck-reader`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrfToken,
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (loadingModal) loadingModal.style.display = "none";

      // Przycisk znika na stałe (usuwamy z drzewa DOM)
      buttonElement.remove();

      await window.Alert(
        `<div style="text-align: left; line-height: 1.5;">
          <p style="color: #146c43; font-weight: bold; margin-bottom: 6px;">🟢 Analiza ukończona!</p>
          <p>${data.message}</p>
         </div>`,
        "Centrum Analityczne AI"
      );

      // Przeładowujemy okno z kotwicą celującą bezpośrednio w nowo utworzony post polemiczny bota
      window.location.href = `/posts/${postId}#post-${data.reportPostId}`;
      window.location.reload(true);

    } else {
      if (loadingModal) loadingModal.style.display = "none";
      buttonElement.disabled = false;
      const errText = await response.text();
      window.Alert(`Nie udało się wywołać audytu AI: ${errText}`, "Błąd krytyczny");
    }
  } catch (err) {
    console.error("Błąd sieciowy Fact-Checkingu czytelnika:", err);
    if (loadingModal) loadingModal.style.display = "none";
    buttonElement.disabled = false;
    window.Alert("Wystąpił błąd połączenia z serwerem operacyjnym.", "Błąd sieci");
  }
};
