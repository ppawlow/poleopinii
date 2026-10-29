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
 * Obsługa asynchronicznego dodawania komentarzy (klasa .comment-form)
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

        if (postCard) {
          // Namierzamy kontener przeznaczony wyłącznie na listę komentarzy
          const targetCommentsListContainer = document.getElementById(
            `comments-list-${postId}`,
          );

          if (targetCommentsListContainer) {
            // Tworzymy tymczasowy parser DOM, aby wyciągnąć nowo wyrenderowaną kartę komentarza
            const tempParser = document.createElement("div");
            tempParser.innerHTML = data.html;

            // Pobieramy wyłącznie węzeł nowo utworzonego komentarza (.comment-card)
            const freshCommentCard = tempParser.querySelector(".comment-card");

            if (freshCommentCard) {
              // KRYTYCZNA POPRAWKA: Zamiast nadpisywać .innerHTML, DOKLEJAMY nowy komentarz na koniec listy!
              targetCommentsListContainer.appendChild(freshCommentCard);
            }
          }

          // =========================================================================
          // AUTOMATYCZNE PRZELICZANIE LICZNIKÓW PO DOKLEJENIU DO DRZEWA DOM
          // =========================================================================
          // Liczymy wszystkie komentarze fizycznie obecne w strukturze strony dla tego posta
          const freshCommentsCount =
            postCard.querySelectorAll(".comment-card").length;

          // 1. Aktualizacja dolnego paska statystyk stopki
          const commentsCountEl = document.getElementById(
            `comments-text-${postId}`,
          );
          if (commentsCountEl) {
            commentsCountEl.innerHTML = liczebnik(freshCommentsCount, [
              "komentarz",
              "komentarze",
              "komentarzy",
            ]);
          }

          // 2. Aktualizacja nagłówka rozwijanej sekcji dyskusji
          const discussionHeadingEl = document.getElementById(
            `discussion-heading-${postId}`,
          );
          if (discussionHeadingEl) {
            discussionHeadingEl.innerHTML = `Dyskusja (${freshCommentsCount})`;
          }
        }

        // Resetowanie wartości pola i zachowanie fokusu dla kolejnego komentarza
        inputField.value = "";
        inputField.style.height = "auto";
        inputField.focus();

        if (typeof window.refreshAccordionListeners === "function") {
          window.refreshAccordionListeners();
        }
      }
    }
  } catch (err) {
    console.error("Błąd podczas asynchronicznego dodawania komentarza:", err);
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
      const targetCard = form.closest(".comment-card, .post-card");
      const postCard = form.closest(".post-card, .editorial-article");

      // Sprawdzamy czy usuwany zasób to komentarz
      const isComment =
        targetCard && targetCard.classList.contains("comment-card");

      if (targetCard) {
        targetCard.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        targetCard.style.opacity = "0";
        targetCard.style.transform = "scale(0.98)";
        setTimeout(() => {
          targetCard.remove();

          // Jeśli usunięto komentarz, natychmiast uaktualniamy liczniki w locie!
          if (isComment && postCard) {
            // Wyciągamy ID posta ze ścieżki akcji formularza usunięcia komentarza
            const urlObj = new URL(form.action, window.location.origin);
            const pathParts = urlObj.pathname.split("/");
            const postId = pathParts[pathParts.indexOf("posts") + 1];

            const freshCommentsCount =
              postCard.querySelectorAll(".comment-card").length;

            const commentsCountEl = document.getElementById(
              `comments-text-${postId}`,
            );
            if (commentsCountEl) {
              commentsCountEl.innerHTML = liczebnik(freshCommentsCount, [
                "komentarz",
                "komentarze",
                "komentarzy",
              ]);
            }

            const discussionHeadingEl = document.getElementById(
              `discussion-heading-${postId}`,
            );
            if (discussionHeadingEl) {
              discussionHeadingEl.innerHTML = `Dyskusja (${freshCommentsCount})`;
            }
          }
        }, 200);
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

// =========================================================================
// CENTRALNY DISPATCHER STRUMIENIA ZDARZEŃ FORMULARZY
// =========================================================================
document.addEventListener("submit", function (e) {
  const form = e.target;
  if (!form || !form.action) return;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  // Edycja komentarza
  if (form.classList.contains("comment-edit-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncCommentEditSubmit(form, csrfToken);
    return;
  }

  // Dodawanie komentarza (wyszukuje dopasowanie niezależnie od innych klas)
  if (form.classList.contains("comment-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncCommentSubmit(form, csrfToken);
    return;
  }

  // Polubienie posta
  if (form.classList.contains("post-like-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncPostLikeSubmit(form, csrfToken);
    return;
  }

  // Blokowanie użytkownika
  if (form.classList.contains("dynamic-block-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncBlockUserSubmit(form, csrfToken);
    return;
  }

  // Usuwanie zasobów
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
  const fbBtn = document.getElementById("share-fb-link");
  const xBtn = document.getElementById("share-x-link");
  const liBtn = document.getElementById("share-li-link");

  if (modal && copyInput) {
    copyInput.value = shareUrl;
    const popupFeatures =
      "width=600,height=450,resizable=yes,scrollbars=yes,status=no";

    if (fbBtn) {
      fbBtn.onclick = function () {
        window.open(
          `https://facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
          "_blank",
          popupFeatures,
        );
      };
    }
    if (xBtn) {
      xBtn.onclick = function () {
        window.open(
          `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(postTitle)}`,
          "_blank",
          popupFeatures,
        );
      };
    }
    if (liBtn) {
      liBtn.onclick = function () {
        window.open(
          `https://linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
          "_blank",
          popupFeatures,
        );
      };
    }

    modal.style.display = "flex";
  }
};
