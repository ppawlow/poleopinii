if (window.Alert === undefined) window.Alert = window.alert;

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

// =========================================================================
// ASYNCHRONICZNE FUNKCJE SKŁADOWE (HANDLER INTERAKCJI BAZY)
// =========================================================================

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
        const postId = form.action.split("/")[2];
        const wrapper = document.getElementById(`comments-wrapper-${postId}`);
        let successfullyInjected = false;

        if (wrapper) {
          const innerBlock = wrapper.querySelector(".article-comments-block");
          if (innerBlock) {
            innerBlock.innerHTML = data.html;
            successfullyInjected = true;
          }
        }

        if (!successfullyInjected) {
          form.insertAdjacentHTML("beforebegin", data.html);
        }

        inputField.value = "";
        inputField.style.height = "auto";

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
        "X-CSRF-Token": csrfToken 
      },
    });

    if (response.ok) {
      const data = await response.json();
      const likeTextEl = form.querySelector(".like-text");
      const iconEl = form.querySelector("i");

      if (data.success) {
        if (likeTextEl) likeTextEl.innerText = data.liked ? "Cofnij" : "Doceń";
        if (iconEl) {
          iconEl.className = data.liked ? "fa-solid fa-star" : "fa-regular fa-star";
        }

        const postCard = form.closest(".post-card, .editorial-article");
        if (postCard) {
          const likesCountEl = postCard.querySelector(".likes-count");
          if (likesCountEl) {
            likesCountEl.innerHTML = `<i class="fa-solid fa-star"></i>  ${data.likesCount} polubień`;
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

// public/js/mainApi.js -> zaktualizuj całą funkcję handleAsyncBlockUserSubmit

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

        if (btnTextSpan) {
          btnTextSpan.innerText = data.isBlocked ? "Odblokuj" : "Zablokuj";
        }
        
        if (iconEl) {
          iconEl.className = data.isBlocked ? "fa-solid fa-shield-halved" : "fa-solid fa-hand";
        }

        if (data.isBlocked) {
          button.classList.add("is-blocking");

          // =========================================================================
          // KRYTYCZNA POPRAWKA UX: CZYSZCZENIE STRUMIENIA OBSERWOWANIA PRZY BLOKADZIE
          // =========================================================================
          
          // 1. Znajdź przycisk obserwowania na stronie i zresetuj go do stanu początkowego
          const followBtn = document.querySelector(".profile-follow-btn");
          if (followBtn) {
            followBtn.classList.remove("is-following");
            const followText = followBtn.querySelector(".btn-text");
            const followIcon = followBtn.querySelector("i");
            if (followText) followText.innerText = "Obserwuj";
            if (followIcon) {
              followIcon.className = "fa-solid fa-user-plus";
              followIcon.style.color = ""; // Czyszczenie zielonego podświetlenia
            }
          }

          // 2. Usuń mój kfelek (avatar) z siatki obserwujących i zmniejsz licznik
          if (window.appUser) {
            const gridContainer = document.getElementById("followers-grid-container");
            const countBadge = document.getElementById("followers-count-badge");

            if (gridContainer && countBadge) {
              const myTile = gridContainer.querySelector(`a[data-user-id="${window.appUser.id}"]`);
              if (myTile) {
                myTile.remove(); // Usuwamy awatar z widoku

                // Odejmij 1 od licznika osób
                let currentCount = parseInt(countBadge.getAttribute("data-count")) || 0;
                currentCount = Math.max(0, currentCount - 1);
                countBadge.setAttribute("data-count", currentCount);
                countBadge.innerText = `${currentCount} osób`;

                // Jeśli brak obserwujących, wstrzyknij tekst alternatywny
                if (currentCount === 0 && !document.getElementById("no-followers-fallback-text")) {
                  gridContainer.innerHTML = `<p id="no-followers-fallback-text" style="font-size: 13px; color: #65676b; text-align: center; margin: 10px 0; grid-column: span 3;">Tego użytkownika nikt jeszcze nie obserwuje.</p>`;
                }
              }
            }
          }
          // =========================================================================

        } else {
          button.classList.remove("is-blocking");
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
  const confirmMsg = form.getAttribute("data-confirm") || "Czy na pewno chcesz usunąć ten zasób?";
  
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
      if (targetCard) {
        targetCard.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        targetCard.style.opacity = "0";
        targetCard.style.transform = "scale(0.98)";
        setTimeout(() => targetCard.remove(), 200);
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
// CENTRALNY DISPATCHER STRUMIENIA ZDARZEŃ FORMULARZY (ZAKTUALIZOWANY)
// =========================================================================
document.addEventListener("submit", function (e) {
  const form = e.target;
  if (!form || !form.action) return;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  // NOWOŚĆ: Przechwytywanie asynchronicznej edycji komentarza
  if (form.matches(".comment-edit-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncCommentEditSubmit(form, csrfToken);
    return;
  }

  if (form.matches(".comment-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncCommentSubmit(form, csrfToken);
    return;
  }

  if (form.matches(".post-like-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncPostLikeSubmit(form, csrfToken);
    return;
  }

  if (form.matches(".dynamic-block-form")) {
    e.preventDefault();
    e.stopPropagation();
    handleAsyncBlockUserSubmit(form, csrfToken);
    return;
  }

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
