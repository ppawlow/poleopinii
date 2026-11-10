function initAccordionListeners() {
  const commentForms = document.querySelectorAll(".comment-submit-on-enter");
  commentForms.forEach((form) => {
    if (!form.dataset.listenerAttached) {
      const textarea = form.querySelector('textarea[name="content"]');
      if (textarea) {
        textarea.addEventListener("input", function () {
          this.style.height = "auto";
          this.style.height = this.scrollHeight + "px";
        });
        form.addEventListener("submit", function () {
          setTimeout(() => {
            textarea.style.height = "auto";
          }, 50);
        });
      }
      form.dataset.listenerAttached = true;
    }
  });

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

function handleUrlHashAnchor() {
  if (!window.location.hash) return;
  const targetId = window.location.hash.replace("#", "");

  function chaseAnchor() {
    const targetElement = document.getElementById(targetId);
    if (
      targetId.startsWith("post-") ||
      targetId.startsWith("discussion-") ||
      targetId.startsWith("comment-")
    ) {
      let postId = null;
      if (targetId.startsWith("post-")) {
        postId = targetId.replace("post-", "");
      } else {
        const wrapper = targetElement
          ? targetElement.closest('[id^="comments-wrapper-"]')
          : null;
        if (wrapper) postId = wrapper.id.replace("comments-wrapper-", "");
        else {
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
        if (commentsContainer) commentsContainer.style.display = "block";
      }
    }

    setTimeout(() => {
      const freshTargetElement = document.getElementById(targetId);
      if (!freshTargetElement) return;

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
      } else {
        freshTargetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
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
    }, 200);
  }
  setTimeout(chaseAnchor, 250);
}

const moveBadgeToFooter = () => {
  const badge = document.querySelector(".grecaptcha-badge");
  const footer = document.querySelector(".site-footer");
  if (badge && footer) footer.appendChild(badge);
  else setTimeout(moveBadgeToFooter, 300);
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
    const textarea = editBlock.querySelector('textarea[name="content"]');
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
      if (!textarea.dataset.resizeAttached) {
        textarea.addEventListener("input", function () {
          this.style.height = "auto";
          this.style.height = this.scrollHeight + "px";
        });
        textarea.dataset.resizeAttached = true;
      }
      textarea.focus();
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
    const cleanName = authorDisplayName.trim();
    inputField.value = `@${cleanName} ` + inputField.value;
    inputField.focus();
  }
}

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
      return resolve(confirm(message));
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

window.toggleCommentsVisibility = function (postId) {
  const commentsContainer = document.getElementById(
    `comments-wrapper-${postId}`,
  );
  if (!commentsContainer) return;
  if (window.getComputedStyle(commentsContainer).display === "none") {
    commentsContainer.style.display = "block";
    setTimeout(() => {
      const discussionHeading = document.getElementById(
        `discussion-heading-${postId}`,
      );
      if (discussionHeading) {
        const yPosition =
          discussionHeading.getBoundingClientRect().top +
          window.pageYOffset -
          80;
        window.scrollTo({ top: yPosition, behavior: "smooth" });
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

window.openLightbox = function (imageSrc) {
  const modal = document.getElementById("custom-lightbox-modal");
  const targetImg = document.getElementById("lightbox-target-image");
  if (modal && targetImg) {
    targetImg.src = imageSrc;
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
};

window.closeLightbox = function () {
  const modal = document.getElementById("custom-lightbox-modal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener(
    "click",
    function (e) {
      if (e.target && e.target.classList.contains("post-media")) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        window.openLightbox(e.target.src);
        return;
      }
      const articleImg = e.target.closest(".article-featured-image img");
      if (articleImg) {
        e.preventDefault();
        window.openLightbox(articleImg.src);
        return;
      }
    },
    true,
  );
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") window.closeLightbox();
  });
});
window.toggleAbuseReportsVisibility = function () {
  const wrapper = document.getElementById("abuse-reports-wrapper");
  const icon = document.getElementById("abuse-accordion-icon");
  if (!wrapper || !icon) return;
  if (window.getComputedStyle(wrapper).display === "none") {
    wrapper.style.display = "block";
    icon.style.transform = "rotate(180deg)";
  } else {
    wrapper.style.display = "none";
    icon.style.transform = "rotate(0deg)";
  }
};
document.addEventListener("DOMContentLoaded", () => {
  const cookieBanner = document.getElementById("cookie-law-banner");
  if (cookieBanner && !localStorage.getItem("cookie_law_accepted"))
    cookieBanner.style.display = "block";
});
window.acceptCookieLaw = function () {
  const cookieBanner = document.getElementById("cookie-law-banner");
  if (cookieBanner) {
    cookieBanner.style.display = "none";
    localStorage.setItem("cookie_law_accepted", "true");
  }
};
// =========================================================================
// ZAAWANSOWANA EMULACJA DOTYKU 1:1 - WARUNKOWA INICJALIZACJA (MANDATORY)
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (window.innerWidth > 900) return;

  const leftSidebar = document.querySelector(".left-sidebar");
  const rightSidebar = document.querySelector(".right-sidebar");
  const mainFeed = document.querySelector("main.feed");
  const mainContainer = document.querySelector(".main-container");
  
  if (!mainContainer || !mainFeed || !leftSidebar || !rightSidebar) return;

  // SYSTEMOWA BLOKADA: Sprawdzamy, czy panele boczne zawierają realną zawartość (np. linki, kafelki, nagłówki)
  // Wykluczamy puste znaki i białe spacje.
  const hasLeftContent = leftSidebar.innerHTML.trim().length > 0;
  const hasRightContent = rightSidebar.innerHTML.trim().length > 0;

  // Jeśli OBA panele boczne są puste, wyłączamy karuzelę i przywracamy standardowy widok
  if (!hasLeftContent && !hasRightContent) {
    mainContainer.style.setProperty("width", "100vw", "important");
    mainContainer.style.setProperty("max-width", "100%", "important");
    mainContainer.style.setProperty("transform", "none", "important");
    mainContainer.style.setProperty("display", "block", "important");
    return; // Przerywamy wykonywanie skryptu gestów i przesłony
  }

  // Wstrzykujemy przesłonę bezpośrednio jako dziecko feedu (tylko jeśli karuzela działa)
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  mainFeed.appendChild(overlay);

  let touchStartX = 0;
  let touchStartY = 0;
  let currentDeltaX = 0;
  let isDragging = false;
  let initialActiveSidebar = "none"; 
  const screenWidth = window.innerWidth;

  function setInteractiveStyles(deltaX, useTransition = false) {
    const transitionStyle = useTransition ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" : "none";
    mainContainer.style.setProperty("transition", transitionStyle, "important");

    let baseOffset = -screenWidth; 

    if (initialActiveSidebar === "left") {
      baseOffset = 0;
    } else if (initialActiveSidebar === "right") {
      baseOffset = -screenWidth * 2;
    }

    let finalTransformX = baseOffset + deltaX;

    // Dodatkowe zabezpieczenie: nie pozwól przesunąć w stronę, która jest pusta
    if (!hasLeftContent && finalTransformX > -screenWidth) finalTransformX = -screenWidth;
    if (!hasRightContent && finalTransformX < -screenWidth) finalTransformX = -screenWidth;

    if (finalTransformX > 0) finalTransformX = 0;
    if (finalTransformX < -screenWidth * 2) finalTransformX = -screenWidth * 2;

    mainContainer.style.setProperty("transform", `translateX(${finalTransformX}px)`, "important");
  }

  function openLeft() {
    if (!hasLeftContent) return closeAllSidebars();
    mainContainer.style.transform = "";
    mainContainer.style.transition = "";
    document.body.classList.remove("has-right-sidebar");
    document.body.classList.add("has-left-sidebar");
    document.body.style.overflow = "hidden";
  }

  function openRight() {
    if (!hasRightContent) return closeAllSidebars();
    mainContainer.style.transform = "";
    mainContainer.style.transition = "";
    document.body.classList.remove("has-left-sidebar");
    document.body.classList.add("has-right-sidebar");
    document.body.style.overflow = "hidden";
  }

  function closeAllSidebars() {
    mainContainer.style.transform = "";
    mainContainer.style.transition = "";
    document.body.classList.remove("has-left-sidebar", "has-right-sidebar");
    document.body.style.overflow = "";
  }

  document.addEventListener("touchstart", (e) => {
    if (e.target.closest(".ql-editor") || e.target.closest("input, textarea, select, .action-btn, button")) return;
    
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    currentDeltaX = 0;
    isDragging = false;

    if (document.body.classList.contains("has-left-sidebar")) {
      initialActiveSidebar = "left";
    } else if (document.body.classList.contains("has-right-sidebar")) {
      initialActiveSidebar = "right";
    } else {
      initialActiveSidebar = "none";
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (e.target.closest(".ql-editor") || e.target.closest("input, textarea, select, .action-btn, button")) return;

    const currentX = e.changedTouches[0].screenX;
    const currentY = e.changedTouches[0].screenY;
    
    const diffX = currentX - touchStartX;
    const diffY = Math.abs(currentY - touchStartY);

    if (!isDragging && Math.abs(diffX) > diffY && Math.abs(diffX) > 10) {
      isDragging = true;
    }

    if (isDragging) {
      if (e.cancelable) e.preventDefault();
      currentDeltaX = diffX;
      setInteractiveStyles(currentDeltaX, false);
    }
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!isDragging) return;
    isDragging = false;

    const dragThreshold = screenWidth * 0.25; 
    setInteractiveStyles(currentDeltaX, true);

    setTimeout(() => {
      if (initialActiveSidebar === "none") {
        if (currentDeltaX > dragThreshold && hasLeftContent) {
          openLeft();
        } else if (currentDeltaX < -dragThreshold && hasRightContent) {
          openRight();
        } else {
          closeAllSidebars();
        }
      } else if (initialActiveSidebar === "left") {
        if (currentDeltaX < -dragThreshold) {
          closeAllSidebars();
        } else {
          openLeft();
        }
      } else if (initialActiveSidebar === "right") {
        if (currentDeltaX > dragThreshold) {
          closeAllSidebars();
        } else {
          openRight();
        }
      }
    }, 50);
  }, { passive: true });

  overlay.addEventListener("click", () => {
    closeAllSidebars();
  });

  document.querySelectorAll(".sidebar-item, .dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      closeAllSidebars();
    });
  });
});

