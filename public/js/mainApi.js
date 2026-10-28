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

// =========================================================================
// CENTRALNY DISPATCHER STRUMIENIA ZDARZEŃ FORMULARZY
// =========================================================================
document.addEventListener("submit", function (e) {
  const form = e.target;
  if (!form || !form.action) return;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  // Rozbicie logiczne żądań na dedykowane, asynchroniczne funkcje składowe
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
