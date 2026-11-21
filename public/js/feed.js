if (window.Alert === undefined) window.Alert = window.alert;

// ==========================================
// REJESTRACJA GLOBALNYCH INSTANCJI I KONFIGURACJI QUILL
// ==========================================
const activeQuillInstances = {};
const activeCropperInstances = {};

function destroyCropperInstance(postId) {
  if (activeCropperInstances[postId]) {
    activeCropperInstances[postId].destroy();
    delete activeCropperInstances[postId];
  }
}

window.setCropperAspect = function (postId, ratio, btnEl) {
  const cropper = activeCropperInstances[postId];
  if (!cropper) return;

  cropper.setAspectRatio(ratio);

  if (Number.isNaN(ratio)) {
    const imageData = cropper.getImageData();
    cropper.setCropBoxData({
      left: 0,
      top: 0,
      width: imageData.width,
      height: imageData.height,
    });
  }

  const container = document.getElementById(`edit-image-preview-container-${postId}`);
  if (container && btnEl) {
    container.querySelectorAll(".crop-ratio-btn").forEach((b) => {
      b.style.background = "rgba(255,255,255,0.2)";
    });
    btnEl.style.background = "#0f5132";
  }
};

window.openEditorPreviewLightbox = function (postId) {
  const cropper = activeCropperInstances[postId];
  if (cropper) {
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 1600,
      maxHeight: 1600,
    });
    if (canvas) {
      window.openLightbox(canvas.toDataURL("image/jpeg", 0.92));
      return;
    }
  }

  const previewImg = document.getElementById(`edit-image-preview-${postId}`);
  if (previewImg && previewImg.src) {
    window.openLightbox(previewImg.src);
  }
};


function getCroppedImageBlob(postId, originalFile) {
  return new Promise((resolve) => {
    const cropper = activeCropperInstances[postId];
    if (!cropper) return resolve(originalFile || null);

    const canvas = cropper.getCroppedCanvas({
      maxWidth: 1600,
      maxHeight: 1600,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    });

    if (!canvas) return resolve(originalFile || null);

    const outputMime =
      originalFile && originalFile.type === "image/png"
        ? "image/png"
        : "image/jpeg";

    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve(originalFile || null);
        const ext = outputMime === "image/png" ? ".png" : ".jpg";
        const baseName = (originalFile?.name || "image").replace(/\.[^/.]+$/, "");
        resolve(new File([blob], `${baseName}${ext}`, { type: outputMime }));
      },
      outputMime,
      0.9
    );
  });
}

const Block = Quill.import("blots/block");

class LeadBlot extends Block {
  static blotName = "lead";
  static tagName = "LEAD";
}

Quill.register(LeadBlot);

const Icons = Quill.import("ui/icons");

Icons["lead"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 512"><!--!Font Awesome Free v7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path fill="rgb(30, 48, 80)" d="M64 432c22.1 0 40 17.9 40 40s-17.9 40-40 40-40-17.9-40-40c0-22.1 17.9-40 40-40zM64 0c26.5 0 48 21.5 48 48 0 .6 0 1.1 0 1.7l-16 304c-.9 17-15 30.3-32 30.3S33 370.7 32 353.7L16 49.7c0-.6 0-1.1 0-1.7 0-26.5 21.5-48 48-48z"/></svg>`;

// Wspólna konfiguracja paska narzędzi dla wszystkich edytorów w systemie
// Wspólna konfiguracja paska narzędzi dla wszystkich edytorów w systemie
const COMMON_QUILL_MODULES = {
  toolbar: {
    container: [
      [{ header: [1, 2, 3, 4, false] }],
      ["bold", "italic", "underline", "strike"],
      [{ list: "ordered" }, { list: "bullet" }],
      [{ indent: "-1" }, { indent: "+1" }],
      [{ align: [] }],
      ["lead", "blockquote"],
      ["link", "image"], // <--- DODANO IKONĘ OBRAZKA DO PASKA QUILL
      ["clean"],
    ],
    handlers: {
      lead: function (value) {
        const range = this.quill.getSelection();
        if (!range) return;

        // Sprawdzamy, czy kursor/zaznaczenie znajduje się w pierwszym bloku (indeks linii === 0)
        const [line] = this.quill.getLine(range.index);
        const lineIndex = this.quill.getIndex(line);

        if (lineIndex !== 0) {
          if (typeof window.Alert === "function") {
            window.Alert(
              "Zajawka artykułu może być ustawiona wyłącznie dla pierwszego akapitu na samym początku wpisu.",
              "Formatowanie artykułu",
            );
          }
          return;
        }

        // Przełączamy format <lead> dla pierwszego bloku
        this.quill.format("lead", value);
      },
      image: function () {
        // Wyciągamy postId z kontenera edytora (np. "edit-quill-new" -> "new")
        const containerId = this.quill.container.id || "";
        const postId = containerId.replace("edit-quill-", "") || "new";
        const fileInput = document.getElementById(`editPostImage-${postId}`);
        if (fileInput) {
          fileInput.click();
        }
      },
    },
  },
};

// ==========================================
// 1. GŁÓWNY INICJATOR STRONY (DOMContentLoaded)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const quillContainerNew = document.getElementById("edit-quill-new");

  if (quillContainerNew && !activeQuillInstances["new"]) {
    activeQuillInstances["new"] = new Quill("#edit-quill-new", {
      theme: "snow",
      placeholder: "O czym myślisz?",
      modules: COMMON_QUILL_MODULES,
    });

    window.initFormChangeTracker("editForm-new", "new");
  }

  // Obsługa zmiany koloru okna edytora przy zmianie widoczności
  const visSelect = document.getElementById("visibility-select-node");
  if (visSelect) {
    window.applyEditorVisibilityTheme(visSelect.value);
    visSelect.addEventListener("change", function () {
      window.applyEditorVisibilityTheme(this.value);
    });
  }

  // Podgląd grafiki dla nowego posta
  const fileInputNew = document.getElementById("editPostImage-new");
  if (fileInputNew) {
    fileInputNew.addEventListener("change", function () {
      window.previewEditImage(this, "new");
    });
  }

  // Dynamiczne nasłuchiwanie zmian plików dla pozostałych formularzy edycji wstrzykniętych do DOM
  document.body.addEventListener("change", function (e) {
    if (e.target && e.target.id && e.target.id.startsWith("editPostImage-")) {
      const postId = e.target.id.replace("editPostImage-", "");
      if (postId !== "new") {
        window.previewEditImage(e.target, postId);
      }
    }
  });
});

window.openCreatePostModal = function () {
  const modal = document.getElementById("create-post-modal");
  if (!modal) return;

  const selectEl = document.getElementById("visibility-select-node");
  if (selectEl) {
    window.applyEditorVisibilityTheme(selectEl.value);
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  if (activeQuillInstances["new"]) {
    setTimeout(() => activeQuillInstances["new"].focus(), 50);
  }
};

window.closeCreatePostModal = function () {
  const modal = document.getElementById("create-post-modal");
  if (!modal) return;
  modal.style.display = "none";
  document.body.style.overflow = "";
};

// Alias dla zachowania wstecznej kompatybilności
window.toggleCreatePostAccordion = window.openCreatePostModal;


// ==========================================
// 2. GLOBALNE FUNKCJE OBSŁUGI FORMULARZY
// ==========================================
window.toggleInlineEdit = async function (postId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (postId === "new") {
    window.openCreatePostModal();
    return;
  }

  const postItem = document.getElementById(`post-${postId}`);
  const editBtn = postItem ? postItem.querySelector(".edit-btn") : null;
  if (!postItem || !editBtn) return;

  const visibility = editBtn.getAttribute("data-visibility") || "private";
  const isLocked = editBtn.getAttribute("data-locked") === "true";
  const currentImage = editBtn.getAttribute("data-image") || "";

  // 1. Obsługa postów publicznych (zgodnie z regulaminem wymagają wycofania do szkicu)
  if (visibility === "public") {
    if (isLocked) {
      const msg =
        "Ten artykuł został zablokowany ze względów bezpieczeństwa lub naruszenia zasad. Czy chcesz wycofać go do prywatnego szkicu, aby nanieść poprawki?";
      if (await window.Confirm(msg, "🛡️ Wpis zablokowany")) {
        await revertToDraft(postId, true);
      }
    } else {
      const msg =
        "Zgodnie z regulaminem bezpośrednia edycja opublikowanych wpisów publicznych jest zablokowana. Czy chcesz wycofać wpis do prywatnego szkicu i otworzyć go do edycji?";
      if (await window.Confirm(msg, "🌐 Post publiczny")) {
        await revertToDraft(postId, true);
      }
    }
    return;
  }

  // 2. Ustawienie trybu reedycji w modalu #create-post-modal
  const editingIdField = document.getElementById("edit-post-id-new");
  if (editingIdField) editingIdField.value = postId;

  const contextSubtitle = document.getElementById("create-post-context-time");
  if (contextSubtitle) {
    contextSubtitle.innerText = "Edycja istniejącego wpisu";
    contextSubtitle.style.color = "#1877f2";
    contextSubtitle.style.fontWeight = "600";
  }

  const staticTitle = document.getElementById(`title-text-${postId}`);
  const titleField = document.getElementById("edit-title-new");
  if (titleField && staticTitle) {
    titleField.value = staticTitle.innerText.trim();
  }

  const selectEl = document.getElementById("visibility-select-node");
  const warningEl = document.getElementById("public-debate-warning-badge");
  if (selectEl) {
    selectEl.value = visibility;
    window.applyEditorVisibilityTheme(visibility);
    if (visibility === "editors") {
      selectEl.disabled = true;
      if (warningEl) {
        warningEl.innerText =
          "🔒 Status zamrożony: Post poufny Kolegium. Zmiana widoczności zablokowana.";
        warningEl.style.display = "inline-block";
      }
    } else {
      selectEl.disabled = false;
      if (warningEl) warningEl.style.display = "none";
    }
  }

  // Wczytanie istniejącej treści HTML do edytora Quill w modalu
  const contentSource = document.getElementById(`content-html-${postId}`);
  const quillInstance = activeQuillInstances["new"];
  if (quillInstance && contentSource) {
    quillInstance.setContents([]);
    quillInstance.clipboard.dangerouslyPasteHTML(contentSource.innerHTML);
  }

  window.resetFormDirtyState("editForm-new");

  // Obsługa podglądu aktualnego zdjęcia zapisanego w bazie
  window.cancelSelectedImage("new");
  const currentImgContainer = document.getElementById("current-image-preview-new");
  const currentImgTag = document.getElementById("current-image-img-new");
  const removeCurrentBtn = document.getElementById("remove-current-image-btn");

  if (currentImgContainer && currentImgTag) {
    if (currentImage) {
      currentImgTag.src = currentImage;
      currentImgContainer.style.display = "block";
      if (removeCurrentBtn) {
        removeCurrentBtn.onclick = () => window.removePostImage(postId);
      }
    } else {
      currentImgTag.src = "";
      currentImgContainer.style.display = "none";
    }
  }

  window.openCreatePostModal();
};

window.previewEditImage = function (input, postId) {
  if (input?.files?.item(0)) {
    const form = document.getElementById(`editForm-${postId}`);
    if (form) form.dataset.isDirty = "true";

    const file = input.files[0];
    const isAnimatedGif = file.type === "image/gif";

    const reader = new FileReader();
    reader.onload = function (e) {
      const previewImg = document.getElementById(`edit-image-preview-${postId}`);
      const previewContainer = document.getElementById(
        `edit-image-preview-container-${postId}`
      );
      const currentPreview = document.getElementById(
        `current-image-preview-${postId}`
      );

      if (previewImg && previewContainer) {
        destroyCropperInstance(postId);
        previewImg.src = e.target.result;
        previewContainer.style.display = "block";

        if (currentPreview) {
          currentPreview.style.display = "none";
        }

        // Reset przycisków trybu do domyślnego Baner 16:9
        const ratioBtns = previewContainer.querySelectorAll(".crop-ratio-btn");
        ratioBtns.forEach((b, idx) => {
          b.style.background = idx === 0 ? "#0f5132" : "rgba(255,255,255,0.2)";
        });

        if (!isAnimatedGif && typeof Cropper !== "undefined") {
          activeCropperInstances[postId] = new Cropper(previewImg, {
            aspectRatio: 16 / 9,
            viewMode: 1,
            autoCropArea: 1,
            responsive: true,
            background: false,
          });
        }
      }
    };
    reader.readAsDataURL(file);
  }
};

window.prepareEditSubmit = async function (event, postId) {
  event.preventDefault();

  const form = document.getElementById(`editForm-${postId}`);
  if (!form) return;

  // Sprawdzamy, czy modal działa w trybie tworzenia nowego posta czy reedycji istniejącego
  const editingIdField = document.getElementById("edit-post-id-new");
  const realPostId =
    postId === "new" && editingIdField && editingIdField.value
      ? editingIdField.value
      : postId;
  const isNewPost = realPostId === "new";

  const submitBtn =
    form.querySelector('button[type="submit"]') ||
    document.querySelector(`button[type="submit"][form="${form.id}"]`);

  if (submitBtn && submitBtn.disabled) return;

  const originalBtnText = submitBtn ? submitBtn.innerText : "";

  const instance = activeQuillInstances[postId];
  const formData = new FormData(form);

  if (instance) {
    formData.set("content", instance.getSemanticHTML());
  } else {
    const hiddenContent = document.getElementById(`edit-hidden-content-${postId}`);
    if (hiddenContent) formData.set("content", hiddenContent.value);
  }

  const fileInput = document.getElementById(`editPostImage-${postId}`);
  const rawFile = fileInput?.files?.item(0) || null;  
  const finalFileToUpload = rawFile ? await getCroppedImageBlob(postId, rawFile) : null;

  if (isNewPost) {
    formData.delete("editPostImage");
    if (finalFileToUpload) {
      formData.set("postImage", finalFileToUpload, finalFileToUpload.name);
    }
  } else if (finalFileToUpload) {
    formData.set("editPostImage", finalFileToUpload, finalFileToUpload.name);
  }
  
  const selectNode = form.querySelector('select[name="visibility"]');
  const currentVis = selectNode ? selectNode.value : "";
  const isPublicVerificationTriggered = currentVis === "public";

  if (selectNode && selectNode.disabled) {
    formData.set("visibility", currentVis);
  }

  const csrfToken = form.getAttribute("data-csrf");
  const targetUrl = isNewPost ? "/posts" : `/posts/${realPostId}/edit`;

  const loadingModal = document.getElementById("custom-loading-modal");
  const loaderHeading = document.getElementById("loader-status-heading");
  const loaderText = document.getElementById("loader-status-text");

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Zapisywanie...";
    submitBtn.style.opacity = "0.7";
  }

  if (loadingModal && isPublicVerificationTriggered) {
    if (loaderHeading) loaderHeading.innerText = "Trwa weryfikacja artykułu";
    if (loaderText)
      loaderText.innerText =
        "Nasz algorytm sztucznej inteligencji właśnie przeprowadza audyt bezpieczeństwa...";
    loadingModal.style.display = "flex";
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: formData,
    });

    // SCENARIUSZ A: STRUMIEŃ SSE (POSTY PUBLICZNE)
    if (response.ok && isPublicVerificationTriggered) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.replace("data: ", "").trim());

            if (data.status === "error") {
              if (loadingModal) loadingModal.style.display = "none";
              await window.Alert(data.error, "🛡️ Ochrona AI");
              return;
            }

            if (data.status === "stage1_success") {
              if (loaderHeading)
                loaderHeading.innerHTML = "🟢 Etap 1 zakończony";
              if (loaderText) loaderText.innerText = data.message;
            }

            if (data.status === "success" && isNewPost) {
              if (loadingModal) loadingModal.style.display = "none";
              window.resetFormDirtyState("editForm-new");
              window.closeCreatePostModal();
              window.location.reload(true);
              return;
            }

            if (data.status === "edit_success") {
              if (loadingModal) loadingModal.style.display = "none";
              window.resetFormDirtyState("editForm-new");
              window.closeCreatePostModal();
              window.location.reload(true);
              return;
            }
          }
        }
      }
      return;
    }

    // SCENARIUSZ B: WPISY PRYWATNE / RESTRICTED / EDITORS / USERS
    if (response.ok) {
      if (loadingModal) loadingModal.style.display = "none";

      // Natychmiast zerujemy flagę niezapisanych zmian, aby żaden reload nie wyzwolił beforeunload
      window.resetFormDirtyState("editForm-new");
      form.dataset.submitting = "true";

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const responseData = await response.json();

        if (isNewPost && responseData.html) {
          const postsWrapper = document.getElementById("accordion-posts-wrapper");

          if (postsWrapper) {
            const noPostsFallback = postsWrapper.querySelector(".no-posts");
            if (noPostsFallback) noPostsFallback.remove();

            postsWrapper.insertAdjacentHTML("afterbegin", responseData.html);

            if (instance) instance.setContents([]);
            const titleField = document.getElementById("edit-title-new");
            if (titleField) {
              titleField.value = "";
              titleField.placeholder = "Dodaj tytuł postu";
            }
            const parentIdField = document.getElementById("edit-parent-id-new");
            if (parentIdField) parentIdField.value = "";

            const contextSubtitle = document.getElementById("create-post-context-time");
            if (contextSubtitle) {
              contextSubtitle.innerText = "Tworzenie nowego wpisu";
              contextSubtitle.style.color = "#65676b";
              contextSubtitle.style.fontWeight = "normal";
            }

            // Reset selektora widoczności i motywu kolorystycznego okna edytora
            const defaultVis = window.location.pathname === "/editors" ? "editors" : "";
            const warningEl = document.getElementById("public-debate-warning-badge");
            if (selectNode) {
              selectNode.disabled = false;
              selectNode.value = defaultVis;
            }
            if (warningEl) warningEl.style.display = "none";
            if (typeof window.applyEditorVisibilityTheme === "function") {
              window.applyEditorVisibilityTheme(defaultVis);
            }

            window.cancelSelectedImage("new");
            window.resetFormDirtyState("editForm-new");
            form.dataset.submitting = "false";
            window.closeCreatePostModal();

            if (typeof window.refreshAccordionListeners === "function") {
              window.refreshAccordionListeners();
            }
          } else {
            window.closeCreatePostModal();
            window.location.reload(true);
          }
        } else {
          window.closeCreatePostModal();
          window.location.reload(true);
        }
      } else {
        window.closeCreatePostModal();
        window.location.reload(true);
      }
    } else {
      if (loadingModal) loadingModal.style.display = "none";
      form.dataset.submitting = "false";
      const responseText = await response.text();
      await window.Alert(responseText, "Błąd walidacji");
    }
  } catch (err) {
    if (loadingModal) loadingModal.style.display = "none";
    console.error("Błąd potoku operacyjnego:", err);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = originalBtnText;
      submitBtn.style.opacity = "";
    }
  }
};


// ==========================================
// 3. ASYNCHRONICZNE STRONICOWANIE POSTÓW (AJAX)
// ==========================================
function loadMorePosts() {
  loadMorePostsChaser();
}

function loadMorePostsChaser() {
  return new Promise((resolve, reject) => {
    const btn = document.getElementById("load-more-btn");
    const wrapper = document.getElementById("accordion-posts-wrapper");
    if (!btn || !wrapper) return resolve(false);

    const currentSkip = wrapper.querySelectorAll(".post-card").length;
    const scope = window.location.pathname === "/editors" ? "editors" : "home";

    btn.innerText = "Ładowanie...";
    btn.disabled = true;

    fetch(`/posts/load-more?skip=${currentSkip}&scope=${scope}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.html) {
          wrapper.insertAdjacentHTML("beforeend", data.html);
        }

        btn.disabled = false;
        btn.innerText = "Pokaż więcej";

        if (!data.hasMore) {
          const container = document.getElementById("load-more-container");
          if (container) container.style.display = "none";
        }

        if (window.refreshAccordionListeners) {
          window.refreshAccordionListeners();
        }

        resolve(data.hasMore);
      })
      .catch((err) => {
        console.error("Błąd ładowania starszych wpisów:", err);
        btn.disabled = false;
        btn.innerText = "Spróbuj ponownie";
        reject(err);
      });
  });
}
// ==========================================
// 4. WYCOFYWANIE POSTÓW PUBLICZNYCH DO SZKICU (Z automatycznym otwieraniem akordeonu)
// ==========================================
async function revertToDraft(postId, skipConfirm = false) {
  if (
    !skipConfirm &&
    !(await Confirm(
      "Czy na pewno chcesz wycofać ten wpis ze strefy publicznej do prywatnego szkicu? Zostanie on również usunięty z fanpage'a na Facebooku.",
    ))
  ) {
    return;
  }

  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");
  try {
    const response = await fetch(`/posts/${postId}/revert-to-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-Token": csrfToken,
      },
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.id) {
        window.location.hash = `post-${data.id}`;
      }
      window.location.reload();
    } else {
      const errorText = await response.text();
      await window.Alert(
        `Wystąpił błąd podczas wycofywania posta: ${errorText}`,
      );
    }
  } catch (err) {
    console.error("Błąd sieciowy podczas operacji revert-to-draft:", err);
    await window.Alert("Błąd sieciowy. Nie udało się wycofać posta.");
  }
}

window.openReplyPostModal = async function (
  parentPostId,
  parentPostTitle,
  isSelfContinuation = false,
) {
  const postCard =
    document.getElementById(`post-${parentPostId}`) ||
    document.querySelector(".editorial-article");
  const isPublicPost =
    postCard &&
    (postCard.innerHTML.includes('title="Publiczny"') ||
      postCard.innerHTML.includes("🌐"));

  if (
    !isSelfContinuation &&
    window.appUser &&
    !window.appUser.isVerified &&
    isPublicPost
  ) {
    await window.Alert(
      `
                <div style="text-align: left; line-height: 1.5;">
                    <p style="margin-bottom: 10px;">Próba opublikowania artykułu w odpowiedzi na <b>🌐 Wpis Publiczny</b> została wstrzymana.</p>
                    <p style="margin-bottom: 12px;">Tworzenie publicznych powiązań dyskusyjnych za pomocą nowych postów jest zastrzeżone dla profili o w pełni potwierdzonej tożsamości.</p>
                    <hr style="border:0; border-top:1px solid #e4e6eb; margin: 10px 0;">
                    <p style="font-size: 13px; color: #65676b;">🔰 <b>Wyjątek:</b> Możesz odpowiedzieć postem niezweryfikowanym tylko wtedy, gdy autor oryginalnego artykułu już obserwuje Twój profil.</p>
                    <p style="margin-top: 14px; text-align: center;"><a href="/verify" style="display: inline-block; background: #1877f2; color: white; padding: 8px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Zweryfikuj konto bankowe</a></p>
                </div>
            `,
      "🛡️ Ograniczenie Odpowiedzi Publicznych",
    );
    return;
  }

  const createModal = document.getElementById("create-post-modal");
  if (!createModal) return;

  const decoder = document.createElement("div");
  decoder.innerHTML = parentPostTitle;
  const decodedTitle = decoder.textContent;

  const titleField = document.getElementById("edit-title-new");
  if (titleField) {
    titleField.value = "";
    titleField.placeholder = isSelfContinuation
      ? "Dodaj tytuł kolejnej części wątku"
      : "Dodaj tytuł polemiki";
  }

  const contextSubtitle = document.getElementById("create-post-context-time");
  if (contextSubtitle) {
    if (isSelfContinuation) {
      contextSubtitle.innerText = `W nawiązaniu do "${decodedTitle}"`;
      contextSubtitle.style.color = "#0f5132";
      contextSubtitle.style.fontWeight = "600";
    } else {
      contextSubtitle.innerText = `Polemika z "${decodedTitle}"`;
      contextSubtitle.style.color = "#bc2525";
      contextSubtitle.style.fontWeight = "600";
    }
  }

  const parentIdHiddenInput = document.getElementById("edit-parent-id-new");
  if (parentIdHiddenInput) {
    parentIdHiddenInput.value = parentPostId;
  }

  const selectEl = document.getElementById("visibility-select-node");
  const warningEl = document.getElementById("public-debate-warning-badge");
  if (selectEl && warningEl) {
    if (isSelfContinuation) {
      selectEl.disabled = false;
      selectEl.value = "";
      window.applyEditorVisibilityTheme("");
      warningEl.style.display = "none";
    } else {
      selectEl.value = "public";
      selectEl.disabled = true;
      window.applyEditorVisibilityTheme("public");
      warningEl.innerText =
        "📢 Uwaga: Polemika z postem publicznym będzie widoczna dla wszystkich użytkowników serwisu.";
      warningEl.style.display = "inline-block";
    }
  }

  window.openCreatePostModal();
};

window.removePostImage = async function (postId) {
  if (!postId || postId === "new") return;
  const confirmed =
    typeof window.Confirm === "function"
      ? await window.Confirm(
          "Czy na pewno chcesz bezpowrotnie usunąć tę grafikę ze swojego posta?",
        )
      : confirm("Czy na pewno chcesz usunąć grafikę?");

  if (!confirmed) return;

  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");
  try {
    const response = await fetch(`/posts/${postId}/delete-image`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrfToken,
      },
    });
    if (response.ok) {
      // 1. Ukrywamy podgląd aktualnego zdjęcia w modalu edycji
      const modalPreview = document.getElementById("current-image-preview-new");
      const currentImgTag = document.getElementById("current-image-img-new");
      if (modalPreview) modalPreview.style.display = "none";
      if (currentImgTag) currentImgTag.src = "";

      // 2. Usuwamy miniaturę z karty posta w DOM i czyścimy atrybut data-image
      const postCard = document.getElementById(`post-${postId}`);
      if (postCard) {
        const editBtn = postCard.querySelector(".edit-btn");
        if (editBtn) editBtn.setAttribute("data-image", "");

        const imgWrap = postCard.querySelector(".portal-card-image-link");
        if (imgWrap) imgWrap.remove();
      }

      window.Alert("Grafika została usunięta.", "Status");
    } else {
      const err = await response.text();
      window.Alert(`Błąd: ${err}`);
    }
  } catch (e) {
    console.error("Błąd sieciowy podczas usuwania zdjęcia:", e);
  }
};

/**
 * Otwiera dedykowany modal zgłaszania nadużyć, wiążąc identyfikator
 * postu nadrzędnego. Działa dla każdego typu użytkownika (w tym Gości).
 */
window.triggerAbuseReport = function (postId, postTitle) {
  const modal = document.getElementById("custom-abuse-modal");
  const parentIdInput = document.getElementById("abuseModalParentPostId");
  const form = document.getElementById("publicAbuseReportForm");

  if (modal && parentIdInput && form) {
    form.reset(); // Czyszczenie pól tekstowych
    parentIdInput.value = postId;

    // Wstrzykujemy flagę raportu bezwzględnego (myliłby gościa z regularnym postem)
    form.setAttribute("data-public-report", !window.appUser ? "true" : "false");

    modal.style.display = "flex";

    const textarea = form.querySelector('textarea[name="content"]');
    if (textarea) textarea.focus();
  }
};

/**
 * Zamyka modal zgłaszania nadużyć
 */
window.closeAbuseModal = function () {
  const modal = document.getElementById("custom-abuse-modal");
  if (modal) modal.style.display = "none";
};

/**
 * Przechwytuje i asynchronicznie wysyła formularz z modalu Abuse.
 * Integruje zabezpieczenie tokenem oraz centralne ominięcia deweloperskie.
 */
window.submitAbuseModalForm = async function (event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const csrfToken = form.querySelector('input[name="_csrf"]').value;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Wysyłanie...";
  }

  const formData = new FormData(form);
  const isCaptchaEnabled = window.env && window.env.useRecaptcha === true;
  const isPublicReport = form.getAttribute("data-public-report") === "true";

  // Endpoint dla zgłoszeń (publiczny, pomijający restrykcje sesyjne routes/posts.js)
  const targetUrl = "/posts/report";

  const fireReportPayload = (bufferData) => {
    fetch(targetUrl, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: bufferData,
    })
      .then(async (response) => {
        if (response.ok) {
          window.closeAbuseModal();
          await window.Alert(
            "🎉 <strong>Zgłoszenie zarejestrowane!</strong><br><br>Dziękujemy za dbanie o porządek i standardy platformy. Zgłoszenie zostało pomyślnie zweryfikowane i przekazane do natychmiastowego rozpatrzenia przez Administratora. Informacja zwrotna zostanie przesłana drogą e-mail.",
            "Centrum Bezpieczeństwa",
          );
        } else {
          const errText = await response.text();
          window.Alert(
            `⚠️ Nie udało się przekazać zgłoszenia:<br><br><b>${errText}</b>`,
            "Błąd zgłoszenia",
          );
        }
      })
      .catch((err) => {
        console.error("Błąd sieciowy wysyłki raportu nadużycia:", err);
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Wyślij zgłoszenie";
        }
      });
  };

  // Obsługa reCAPTCHA Enterprise dla zgłoszeń publicznych
  if (isPublicReport && !isCaptchaEnabled) {
    formData.set("recaptchaToken", "BYPASS_TOKEN_CAPTCHA_DISABLED");
    fireReportPayload(formData);
  } else if (
    isPublicReport &&
    typeof grecaptcha !== "undefined" &&
    grecaptcha.enterprise &&
    window.env &&
    window.env.RECAPTCHA_SITE_KEY
  ) {
    grecaptcha.enterprise.ready(function () {
      grecaptcha.enterprise
        .execute(window.env.RECAPTCHA_SITE_KEY, { action: "submit_abuse" })
        .then(function (token) {
          formData.set("recaptchaToken", token);
          fireReportPayload(formData);
        });
    });
  } else {
    formData.set("recaptchaToken", "SIGNED_USER_AUTHTOKEN");
    fireReportPayload(formData);
  }
};

// public/js/feed.js

/**
 * Anuluje wybrany plik graficzny z poziomu formularza przed jego wysłaniem na serwer.
 * Obsługuje zarówno kreator 'new', jak i reedycję istniejących szkiców.
 */
window.cancelSelectedImage = function (postId) {
  destroyCropperInstance(postId);

  const inputId =
    postId === "new" ? "editPostImage-new" : `editPostImage-${postId}`;
  const fileInput = document.getElementById(inputId);

  if (fileInput) {
    fileInput.value = "";
  }

  const previewContainer = document.getElementById(
    `edit-image-preview-container-${postId}`,
  );
  const previewImg = document.getElementById(`edit-image-preview-${postId}`);

  if (previewContainer) {
    previewContainer.style.display = "none";
  }
  if (previewImg) {
    previewImg.src = "";
  }

  const editingIdField = document.getElementById("edit-post-id-new");
  const currentPreview = document.getElementById("current-image-preview-new");
  const currentImgTag = document.getElementById("current-image-img-new");
  if (
    postId === "new" &&
    editingIdField &&
    editingIdField.value &&
    currentPreview &&
    currentImgTag &&
    currentImgTag.getAttribute("src")
  ) {
    currentPreview.style.display = "block";
  }

  const form = document.getElementById(`editForm-${postId}`);
  const titleField = document.getElementById(`edit-title-${postId}`);
  const instance = activeQuillInstances[postId];
  const isEditingExisting = Boolean(editingIdField && editingIdField.value);

  if (form && !isEditingExisting) {
    const hasTitle = titleField && titleField.value.trim().length > 0;
    const hasContent = instance && instance.getText().trim().length > 0;
    if (!hasTitle && !hasContent) {
      form.dataset.isDirty = "false";
    }
  }
};

/**
 * Bezpieczne anulowanie edycji posta.
 * Sprawdza, czy w formularzu znajdują się niezapisane zmiany i ostrzega użytkownika.
 */
window.safeCancelInlineEdit = async function (postId) {
  const formEl = document.getElementById(`editForm-${postId}`);
  const titleField = document.getElementById(`edit-title-${postId}`);
  const instance = activeQuillInstances[postId];
  const fileInput = document.getElementById(`editPostImage-${postId}`);
  const selectEl = document.getElementById("visibility-select-node");
  const editingIdField = document.getElementById("edit-post-id-new");

  const hasChanges = Boolean(formEl && formEl.dataset.isDirty === "true");

  if (hasChanges) {
    const message =
      "Masz niezapisane zmiany w tym poście. Czy na pewno chcesz anulować edycję? Cały wpisany tekst zostanie bezpowrotnie utracony.";
    const confirmed =
      typeof window.Confirm === "function"
        ? await window.Confirm(message, "Porzucić zmiany?")
        : confirm(message);

    if (!confirmed) return;
  }

  // Pełny reset modalu i wyzerowanie flagi zmian
  window.resetFormDirtyState(`editForm-${postId}`);
  if (editingIdField) editingIdField.value = "";

  if (titleField) {
    titleField.value = "";
    titleField.placeholder = "Dodaj tytuł postu";
  }
  if (instance) instance.setContents([]);

  const currentImgContainer = document.getElementById("current-image-preview-new");
  const currentImgTag = document.getElementById("current-image-img-new");
  if (currentImgContainer) currentImgContainer.style.display = "none";
  if (currentImgTag) currentImgTag.src = "";

  const previewContainer = document.getElementById("edit-image-preview-container-new");
  if (previewContainer) previewContainer.style.display = "none";

  if (fileInput) fileInput.value = "";

  const contextSubtitle = document.getElementById("create-post-context-time");
  if (contextSubtitle) {
    contextSubtitle.innerText = "Tworzenie nowego wpisu";
    contextSubtitle.style.color = "#65676b";
    contextSubtitle.style.fontWeight = "normal";
  }

  const warningResetEl = document.getElementById("public-debate-warning-badge");
  if (selectEl && warningResetEl) {
    selectEl.disabled = false;
    selectEl.value = "";
    window.applyEditorVisibilityTheme("");
    warningResetEl.style.display = "none";
  }

  const parentIdReset = document.getElementById("edit-parent-id-new");
  if (parentIdReset) parentIdReset.value = "";

  window.closeCreatePostModal();
};

/**
 * Inicjalizuje formularz nowego wpisu danymi pobranymi z modułu Tematów Dnia AI
 * @param {string} title - Tytuł wydarzenia AI
 * @param {string} summary - Skrócona treść wiadomości AI
 */
window.initAiTopicDiscussion = function (title, summary) {
  const createModal = document.getElementById("create-post-modal");

  if (!createModal) {
    window.Alert(
      "🔒 Funkcja niedostępna: Aby publikować polemiki i komentarze do wydarzeń AI, musisz najpierw zalogować się do swojego konta.",
      "Autoryzacja systemu",
    );
    window.location.href = "/auth/login";
    return;
  }

  // Widok mobilny: zamykamy otwarty boczny panel "Przegląd dnia"
  const isMobileCarousel =
    window.innerWidth <= 900 &&
    document.querySelector(".main-container:not(:has(.editorial-article))");
  if (isMobileCarousel) {
    const mainContainer = document.querySelector(".main-container");
    if (mainContainer) {
      mainContainer.style.transform = "";
      mainContainer.style.transition = "";
    }
    document.body.classList.remove("has-left-sidebar", "has-right-sidebar");
  }

  window.openCreatePostModal();

  const titleField = document.getElementById("edit-title-new");
  if (titleField) {
    titleField.value = title.trim();
  }

  const quillInstance = activeQuillInstances["new"];
  if (quillInstance) {
    const formattedHtml = `<lead>${summary.trim()}</lead><p><br></p>`;
    quillInstance.clipboard.dangerouslyPasteHTML(formattedHtml);
    const formEl = document.getElementById("editForm-new");
    if (formEl) formEl.dataset.isDirty = "true";

    setTimeout(() => {
      quillInstance.focus();
      quillInstance.setSelection(quillInstance.getLength(), 0);
    }, 100);
  }
};

/**
 * Wysyła asynchroniczne odwołanie od decyzji weryfikacyjnej AI do moderatora platformy
 */
window.submitAiAppeal = async function (postId, buttonElement) {
  if (!postId || !buttonElement) return;

  const csrfToken = document
    .querySelector('meta[name="csrf-token"]')
    .getAttribute("content");

  buttonElement.disabled = true;
  buttonElement.innerText = "Wysyłanie prośby...";

  try {
    const response = await fetch(`/posts/${postId}/appeal`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrfToken,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      buttonElement.style.background = "#42b72a";
      buttonElement.innerText = "✓ Prośba przekazana";

      await window.Alert(
        "⚖️ <strong>Odwołanie zostało zarejestrowane!</strong><br><br>Główny administrator platformy został powiadomiony mailowo o konieczności przeprowadzenia manualnego audytu Twojego tekstu. Decyzja zostanie podjęta wkrótce.",
        "Weryfikacja rzetelności",
      );
    } else {
      const errText = await response.text();
      buttonElement.disabled = false;
      buttonElement.innerText = "⚖️ Poproś o weryfikację człowieka";
    }
  } catch (err) {
    console.error("Błąd sieciowy wysyłki odwołania:", err);
    buttonElement.disabled = false;
    buttonElement.innerText = "⚖️ Poproś o weryfikację człowieka";
  }
};

// =========================================================================
// SYGNAŁ DŹWIĘKOWY (WEB AUDIO API) + ANIMACJA WIZUALNA POWIADOMIEŃ
// =========================================================================
let sharedAudioCtx = null;

function unlockAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume().catch(() => {});
  }
}

// Odblokowanie audio przy pierwszej interakcji użytkownika ze stroną
["click", "touchstart", "keydown"].forEach((evt) => {
  document.addEventListener(evt, unlockAudioContext, { once: true, passive: true });
});

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }

    const now = sharedAudioCtx.currentTime;
    // Przyjemny, miękki dwutonowy dzwonek (C6 -> E6)
    const notes = [1046.5, 1318.51];

    notes.forEach((freq, idx) => {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.35);

      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);

      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.36);
    });
  } catch (e) {
    // Ignorujemy blokadę autoodtwarzania, jeśli użytkownik nie wszedł jeszcze w interakcję
  }
}

function triggerVisualNotificationAttention() {
  // 1. Czerwona kropka + pulsująca fala (w pasku nawigacji oraz wewnątrz menu)
  if (window.location.pathname !== "/events") {
    document.querySelectorAll(".unread-events-dot").forEach((dot) => {
      dot.style.display = "block";
      dot.classList.add("is-pulsing");
    });
  }

  // 2. Animacja dzwoneczka (restartuje animację przy każdym kolejnym powiadomieniu)
  document.querySelectorAll('a[href="/events"] i.fa-bell').forEach((bellIcon) => {
    bellIcon.classList.remove("notif-attention-ring");
    void bellIcon.offsetWidth; // Wymuszenie przeliczenia stylu do restartu animacji CSS
    bellIcon.classList.add("notif-attention-ring");
  });

  // 3. Animacja przycisku menu (⋮) na urządzeniach mobilnych, gdzie pasek środkowy jest ukryty
  const mobileMenuBtn = document.getElementById("navDropdownBtn");
  if (mobileMenuBtn) {
    mobileMenuBtn.classList.remove("has-new-notif");
    void mobileMenuBtn.offsetWidth;
    mobileMenuBtn.classList.add("has-new-notif");
  }

  // 4. Delikatna wibracja na urządzeniach mobilnych (jeśli przeglądarka wspiera)
  if (navigator.vibrate) {
    navigator.vibrate([120, 60, 120]);
  }
}

function initGlobalWebSocket() {
  // Łączymy się tylko dla zalogowanych użytkowników
  if (!window.appUser) return;

  const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
  const currentPath = encodeURIComponent(window.location.pathname);
  const wsUrl = `${protocol}${window.location.host}/?path=${currentPath}`;
  const socket = new WebSocket(wsUrl);

  // Pomocnik aktualizujący token CSRF wewnątrz kodu HTML otrzymanego z serwera
  function syncCsrfTokens(containerElement) {
    const myCsrf = document
      .querySelector('meta[name="csrf-token"]')
      ?.getAttribute("content");
    if (!containerElement) return;

    if (myCsrf) {
      containerElement
        .querySelectorAll('input[name="_csrf"]')
        .forEach((input) => {
          input.value = myCsrf;
        });
    }

    // Dopasowanie przycisków Edytuj / Usuń do tożsamości odbiorcy WebSocket
    if (window.appUser && window.appUser.id) {
      const myId = String(window.appUser.id);
      containerElement.querySelectorAll(".comment-card").forEach((card) => {
        const editBtn = card.querySelector(".comment-edit-trigger");
        const delForm = card.querySelector(".comment-delete-form");
        const cAuthorId =
          editBtn?.getAttribute("data-author-id") ||
          delForm?.getAttribute("data-comment-author-id");
        const pAuthorId = delForm?.getAttribute("data-post-author-id");

        if (editBtn && cAuthorId && cAuthorId !== myId) {
          editBtn.remove();
        }
        if (delForm && cAuthorId !== myId && pAuthorId !== myId) {
          delForm.remove();
        }
      });
    }
  }

  socket.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);

      // ===========================================================
      // 1. NOWY POST NA ŻYWO (Strona główna, Obserwowani, Redakcja)
      // ===========================================================
      if (data.type === "NEW_POST" && data.html) {
        const path = window.location.pathname;
        const isAllowedFeed =
          path === "/" ||
          path === "/following-feed" ||
          (path === "/editors" && data.visibility === "editors");

        const postsWrapper = document.getElementById("accordion-posts-wrapper");
        if (isAllowedFeed && postsWrapper) {
          const noPostsFallback = postsWrapper.querySelector(".no-posts");
          if (noPostsFallback) noPostsFallback.remove();

          const tempContainer = document.createElement("div");
          tempContainer.innerHTML = data.html;
          syncCsrfTokens(tempContainer); // Krytyczne dla formularzy polubień i komentarzy

          const freshPostCard = tempContainer.firstElementChild;
          if (freshPostCard) {
            freshPostCard.style.opacity = "0";
            freshPostCard.style.transform = "translateY(-15px)";
            freshPostCard.style.transition = "all 0.35s ease";

            postsWrapper.insertBefore(freshPostCard, postsWrapper.firstChild);

            requestAnimationFrame(() => {
              freshPostCard.style.opacity = "1";
              freshPostCard.style.transform = "translateY(0)";
            });

            if (typeof window.refreshAccordionListeners === "function") {
              window.refreshAccordionListeners();
            }
          }
        }
      }

      // ===========================================================
      // 2a. NOWY KOMENTARZ NA ŻYWO (W dowolnym widoku z tym postem)
      // ===========================================================
      if (data.type === "NEW_COMMENT" && data.html && data.postId) {
        const postCard = document.getElementById(`post-${data.postId}`);
        const commentsWrapper = document.getElementById(
          `comments-wrapper-${data.postId}`,
        );

        if (commentsWrapper && postCard) {
          const targetBlock = commentsWrapper.querySelector(
            ".article-comments-block",
          );

          if (targetBlock) {
            const activeInput = targetBlock.querySelector(
              `#comment-input-field-${data.postId}`,
            );
            const isUserTyping = activeInput === document.activeElement;
            const currentTypingValue = activeInput ? activeInput.value : "";

            targetBlock.innerHTML = data.html;
            syncCsrfTokens(targetBlock); // Podmiana tokenu CSRF w nowych formularzach

            if (isUserTyping) {
              const freshInput = targetBlock.querySelector(
                `#comment-input-field-${data.postId}`,
              );
              if (freshInput) {
                freshInput.value = currentTypingValue;
                freshInput.focus();
              }
            }
          }

          const freshCommentsCount =
            commentsWrapper.querySelectorAll(".comment-card").length;

          const commentsCountEl = document.getElementById(
            `comments-text-${data.postId}`,
          );
          if (commentsCountEl && typeof liczebnik === "function") {
            commentsCountEl.innerHTML = liczebnik(freshCommentsCount, [
              "komentarz",
              "komentarze",
              "komentarzy",
            ]);
          }

          const discussionHeadingEl = document.getElementById(
            `discussion-heading-${data.postId}`,
          );
          if (discussionHeadingEl) {
            discussionHeadingEl.innerHTML = `Dyskusja (${freshCommentsCount})`;
          }

          if (typeof window.refreshAccordionListeners === "function") {
            window.refreshAccordionListeners();
          }
        }
      }
      
      // ===========================================================
      // 2b. USUNIĘCIE KOMENTARZA NA ŻYWO (U innych czytających wątek)
      // ===========================================================
      if (data.type === "DELETE_COMMENT" && data.postId && data.commentId) {
        const commentCard = document.getElementById(`comment-${data.commentId}`);
        const commentsWrapper = document.getElementById(
          `comments-wrapper-${data.postId}`,
        );

        if (commentCard) {
          commentCard.style.transition = "opacity 0.2s ease, transform 0.2s ease";
          commentCard.style.opacity = "0";
          commentCard.style.transform = "scale(0.98)";

          setTimeout(() => {
            commentCard.remove();

            if (commentsWrapper) {
              const freshCommentsCount =
                commentsWrapper.querySelectorAll(".comment-card").length;

              const commentsCountEl = document.getElementById(
                `comments-text-${data.postId}`,
              );
              if (commentsCountEl && typeof liczebnik === "function") {
                commentsCountEl.innerHTML = liczebnik(freshCommentsCount, [
                  "komentarz",
                  "komentarze",
                  "komentarzy",
                ]);
              }

              const discussionHeadingEl = document.getElementById(
                `discussion-heading-${data.postId}`,
              );
              if (discussionHeadingEl) {
                discussionHeadingEl.innerHTML = `Dyskusja (${freshCommentsCount})`;
              }

              const commentsListContainer = document.getElementById(
                `comments-list-${data.postId}`,
              );
              if (
                freshCommentsCount === 0 &&
                commentsListContainer &&
                !document.getElementById(`no-comments-notice-${data.postId}`)
              ) {
                commentsListContainer.insertAdjacentHTML(
                  "afterbegin",
                  `<div class="no-comments-placeholder" id="no-comments-notice-${data.postId}" style="font-size: 13px; color: #65676b; font-style: italic; padding: 8px 12px; margin-bottom: 12px;">💬 Brak komentarzy. Rozpocznij dyskusję jako pierwszy!</div>`,
                );
              }
            }
          }, 200);
        }
      }
      
      // ===========================================================
      // 2c. EDYCJA KOMENTARZA NA ŻYWO (U innych czytających wątek)
      // ===========================================================
      if (data.type === "EDIT_COMMENT" && data.commentId && typeof data.content === "string") {
        const commentTextEl = document.getElementById(`comment-text-${data.commentId}`);
        if (commentTextEl && commentTextEl.textContent !== data.content) {
          commentTextEl.textContent = data.content;

          const commentBubble = document.getElementById(
            `comment-content-container-${data.commentId}`,
          );
          if (commentBubble) {
            commentBubble.style.transition = "background-color 0.4s ease";
            const originalBg = commentBubble.style.backgroundColor;
            commentBubble.style.backgroundColor = "#e7f3ff";
            setTimeout(() => {
              commentBubble.style.backgroundColor = originalBg;
            }, 1200);
          }
        }
      }

      // ===========================================================
      // 3. POWIADOMIENIE W CZASIE RZECZYWISTYM (Dźwięk + Animacja + /events)
      // ===========================================================
      if (data.type === "NEW_NOTIFICATION") {
        playNotificationSound();
        triggerVisualNotificationAttention();

        if (window.location.pathname === "/events") {
          fetch("/events/api")
            .then((res) => res.json())
            .then((resData) => {
              const eventsWrapper = document.getElementById(
                "events-list-wrapper",
              );
              if (resData.success && eventsWrapper && Array.isArray(resData.events)) {
                eventsWrapper.innerHTML = resData.events
                  .map((ev) => ev.html)
                  .join("");
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error("[WebSocket] Błąd przetwarzania pakietu danych:", err);
    }
  };

  socket.onclose = () => {
    setTimeout(initGlobalWebSocket, 5000);
  };

  socket.onerror = () => {
    socket.close();
  };
}

document.addEventListener("DOMContentLoaded", () => {
  initGlobalWebSocket();
});
window.setFeedViewMode = function (mode, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget;
    const label = document.getElementById("feed-view-label");
    if (btn && label && btn.title) {
      label.textContent = btn.title;
    }
  }
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  if (!window.appUser) return;
  const validMode = mode === "portal" ? "portal" : "accordion";
  document.cookie = `feedView=${validMode}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
  window.location.reload();
};

/**
 * Rejestruje nasłuchiwanie rzeczywistych zmian użytkownika na wszystkich polach formularza
 * oraz na instancji edytora Quill (ignorując programowe wczytywanie treści przez API).
 */
window.initFormChangeTracker = function (formId, quillKey) {
  const form = document.getElementById(formId);
  if (!form || form.dataset.trackerAttached === "true") return;

  form.dataset.isDirty = "false";

  const markAsDirty = () => {
    form.dataset.isDirty = "true";
  };

  // Nasłuchujemy zarówno 'input' (wpisywanie na żywo w tytule), jak i 'change' (select widoczności, wybór pliku)
  form.addEventListener("input", markAsDirty);
  form.addEventListener("change", markAsDirty);

  // Nasłuchujemy wyłącznie zmian wykonanych przez człowieka w edytorze Quill (source === 'user')
  const quillInstance = activeQuillInstances[quillKey];
  if (quillInstance) {
    quillInstance.on("text-change", function (delta, oldDelta, source) {
      if (source === "user") {
        markAsDirty();
      }
    });
  }

  form.dataset.trackerAttached = "true";
};

window.resetFormDirtyState = function (formId) {
  const form = document.getElementById(formId);
  if (form) {
    form.dataset.isDirty = "false";
  }
};

/**
 * Ostrzeżenie przeglądarki przed zamknięciem karty / odświeżeniem strony,
 * gdy modal edytora jest otwarty i zawiera niezapisane zmiany.
 */
window.addEventListener("beforeunload", function (event) {
  const modal = document.getElementById("create-post-modal");
  const form = document.getElementById("editForm-new");

  const isModalOpen = modal && modal.style.display !== "none";
  const isSubmitting = form && form.dataset.submitting === "true";
  const hasUnsavedChanges = form && form.dataset.isDirty === "true";

  if (isModalOpen && hasUnsavedChanges && !isSubmitting) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.applyEditorVisibilityTheme = function (visibility) {
  const modalBox = document.querySelector("#create-post-modal .custom-modal-box");
  if (!modalBox) return;

  modalBox.classList.remove(
    "vis-theme-public",
    "vis-theme-restricted",
    "vis-theme-private",
    "vis-theme-editors",
    "vis-theme-users",
  );

  if (visibility) {
    modalBox.classList.add(`vis-theme-${visibility}`);
  }
};

window.toggleEditorImageSection = function (sectionType, postId, btnEl) {
  const bodyId =
    sectionType === "current"
      ? `current-image-body-${postId}`
      : `crop-image-body-${postId}`;
  const bodyEl = document.getElementById(bodyId);
  if (!bodyEl) return;

  const isHidden = bodyEl.style.display === "none";
  const defaultDisplay = sectionType === "crop" ? "flex" : "block";
  bodyEl.style.display = isHidden ? defaultDisplay : "none";

  if (btnEl) {
    const icon = btnEl.querySelector("i");
    const label = btnEl.querySelector("span");
    if (icon) {
      icon.className = isHidden ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
    }
    if (label) {
      label.textContent = isHidden ? "Ukryj obrazek" : "Pokaż obrazek";
    }
  }
};
