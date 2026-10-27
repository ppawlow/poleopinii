if (window.Alert === undefined) window.Alert = window.alert;

// ==========================================
// REJESTRACJA GLOBALNYCH INSTANCJI I KONFIGURACJI QUILL
// ==========================================
const activeQuillInstances = {};

// Wspólna konfiguracja paska narzędzi dla wszystkich edytorów w systemie
const COMMON_QUILL_MODULES = {
  toolbar: [
    // Wybór czcionki i jej rozmiaru
    [{ header: [1, 2, 3, 4, false] }],

    // Podstawowe formatowanie i kolory
    ["bold", "italic", "underline", "strike"],
    // [{ 'color': [] }, { 'background': [] }],

    // Listy, wcięcia i wyrównanie
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    [{ align: [] }],

    // Cytaty, kod i multimedia
    // ['blockquote', 'code-block'],
    // ['link', 'image', 'video'],
    ["blockquote"],
    ["link"],
    // ['link', 'image', 'video'],

    // Czyszczenie formatowania (usuwa style z zaznaczonego tekstu)
    ["clean"],
  ],
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
      modules: COMMON_QUILL_MODULES, // Użycie wspólnej konfiguracji
    });

    // const createPostFormBlock = document.getElementById('editForm-new');
    // if (createPostFormBlock) {
    //     const cancelBtn = createPostFormBlock.querySelector('button[type="button"]');
    //     if (cancelBtn) {
    //         cancelBtn.style.display = 'none';
    //     }
    // }
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

// Dedykowana funkcja do otwierania/zamykania akordeonu tworzenia postów
window.toggleCreatePostAccordion = function () {
  const header = document.querySelector("#post-new .accordion-header");
  const content = document.querySelector(".create-accordion-content");
  const icon = document.querySelector(".create-accordion-icon");
  if (!content || !header) return;

  const isOpen = content.style.display === "block";

  // Zamykamy inne otwarte akordeony zwykłych postów
  document
    .querySelectorAll(".accordion-content")
    .forEach((c) => (c.style.display = "none"));
  document.querySelectorAll(".accordion-icon").forEach((i) => {
    if (i) i.style.transform = "rotate(0deg)";
  });

  if (!isOpen) {
    // Po aktywacji: ukrywamy nagłówek i pokazujemy pełny formularz
    header.style.display = "none";
    content.style.display = "block";
    if (icon) icon.style.transform = "rotate(180deg)";
  } else {
    // Przy zamykaniu: przywracamy widoczność nagłówka
    header.style.display = "flex";
    content.style.display = "none";
    if (icon) icon.style.transform = "rotate(0deg)";
  }
};

// ==========================================
// 2. GLOBALNE FUNKCJE OBSŁUGI FORMULARZY (Wstrzyknięte do window)
// ==========================================

window.toggleInlineEdit = function (postId, event) {
  if (postId === "new") {
    window.toggleCreatePostAccordion();
    return;
  }

  const postItem = document.getElementById(`post-${postId}`);
  const wrapperBlock = document.getElementById(`edit-form-block-${postId}`);
  const viewBlock = document.getElementById(`view-${postId}`);
  const staticTitle = document.getElementById(`title-text-${postId}`);

  if (!wrapperBlock || !postItem) return;

  const accordionContent = postItem.querySelector(".accordion-content");
  const accordionIcon = postItem.querySelector(".accordion-icon");

  // 1. Wymuszamy otwarcie głównego akordeonu posta
  if (accordionContent) {
    accordionContent.style.display = "block";
  }
  if (accordionIcon) {
    accordionIcon.style.transform = "rotate(180deg)";
  }

  const isHidden =
    window.getComputedStyle(wrapperBlock).display === "none" ||
    wrapperBlock.style.display === "none";

  if (isHidden) {
    // Pokazujemy formularz edycji, ukrywamy statyczną treść i tytuł
    wrapperBlock.style.display = "block";
    if (viewBlock) viewBlock.style.display = "none";
    if (staticTitle) staticTitle.style.display = "none";

    // Inicjalizacja edytora Quill
    const quillContainer = document.getElementById(`edit-quill-${postId}`);
    if (quillContainer && !activeQuillInstances[postId]) {
      activeQuillInstances[postId] = new Quill(`#edit-quill-${postId}`, {
        theme: "snow",
        modules: COMMON_QUILL_MODULES,
      });
      const contentSource = document.getElementById(`content-html-${postId}`);
      if (contentSource) {
        activeQuillInstances[postId].clipboard.dangerouslyPasteHTML(
          contentSource.innerHTML,
        );
      }
    }
  } else {
    // Powrót do widoku czytania
    wrapperBlock.style.display = "none";
    if (viewBlock) viewBlock.style.display = "block";
    if (staticTitle) staticTitle.style.display = "block";
  }
};

window.previewEditImage = function (input, postId) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function (e) {
      const previewImg = document.getElementById(
        `edit-image-preview-${postId}`,
      );
      const previewContainer = document.getElementById(
        `edit-image-preview-container-${postId}`,
      );
      const currentPreview = document.getElementById(
        `current-image-preview-${postId}`,
      );

      if (previewImg && previewContainer) {
        previewImg.src = e.target.result;
        previewContainer.style.display = "block";

        if (currentPreview) {
          currentPreview.style.display = "none";
        }
      }
    };
    reader.readAsDataURL(file);
  }
};

// public/js/feed.js -> Kompletna i zintegrowana funkcja window.prepareEditSubmit

window.prepareEditSubmit = async function (event, postId) {
  event.preventDefault();

  const form = document.getElementById(`editForm-${postId}`);
  if (!form) return;

  const instance = activeQuillInstances[postId];
  const formData = new FormData(form);

  if (instance) {
    formData.set("content", instance.getSemanticHTML());
  } else {
    const hiddenContent = document.getElementById(
      `edit-hidden-content-${postId}`,
    );
    if (hiddenContent) formData.set("content", hiddenContent.value);
  }

  if (postId === "new") {
    const fileInput = document.getElementById("editPostImage-new");
    formData.delete("editPostImage");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      formData.set("postImage", fileInput.files[0]);
    }
  }

  const selectNode = form.querySelector('select[name="visibility"]');
  const isPublicVerificationTriggered =
    (selectNode && selectNode.value === "public") ||
    (selectNode && selectNode.disabled);

  if (selectNode && selectNode.disabled) {
    formData.set("visibility", "public");
  }

  const csrfToken = form.getAttribute("data-csrf");
  const targetUrl = postId === "new" ? "/posts" : `/posts/${postId}/edit`;

  const loadingModal = document.getElementById("custom-loading-modal");
  const loaderHeading = document.getElementById("loader-status-heading");
  const loaderText = document.getElementById("loader-status-text");

  if (loaderHeading) loaderHeading.innerText = "Trwa weryfikacja artykułu";
  if (loaderText)
    loaderText.innerText =
      "Nasz algorytm sztucznej inteligencji właśnie przeprowadza dwuetapowy audyt bezpieczeństwa...";

  if (loadingModal && isPublicVerificationTriggered) {
    loadingModal.style.display = "flex";
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: formData,
    });

    // =========================================================================
    // SCENARIUSZ A: OBSŁUGA POŁĄCZENIA STRUMIENIOWEGO (DLA POSTÓW PUBLICZNYCH)
    // =========================================================================
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
              const formattedReport = data.report
                ? `<hr style="border:0; border-top:1px solid #dddfe2; margin:14px 0;"><div style="background:#fff3f3; padding:14px; border-radius:6px; border-left:4px solid #bc2525; font-size:13px; text-align:left; color:#1c1e21; white-space:pre-wrap; font-family:sans-serif; line-height:1.5;"><strong>📋 Raport AI:</strong><br><br>${data.report}</div>`
                : "";
              await window.Alert(
                `<div><p><strong>⚠️ Błąd:</strong> ${data.error}</p>${formattedReport}</div>`,
                "🛡️ Ochrona AI",
              );
              return;
            }

            if (data.status === "stage1_success") {
              if (loaderHeading)
                loaderHeading.innerHTML = "🟢 Etap 1 zakończony";
              if (loaderText) loaderText.innerText = data.message;
            }

            // POPRAWKA: Automatyczne wstrzyknięcie lub przeładowanie po sukcesie nowego wpisu publicznego
            if (data.status === "success" && postId === "new") {
              if (loadingModal) loadingModal.style.display = "none";
              window.location.reload(true); // Twarde odświeżenie gwarantuje załadowanie pełnej osi czasu bazy danych
              return;
            }

            if (data.status === "edit_success") {
              if (loadingModal) loadingModal.style.display = "none";
              window.location.reload(true);
              return;
            }
          }
        }
      }
      return;
    }

    // =========================================================================
    // SCENARIUSZ B: TRADYCYJNA OBSŁUGA JSON (DLA WPISÓW PRYWATNYCH / RESTRICTED)
    // =========================================================================
    if (response.ok) {
      if (loadingModal) loadingModal.style.display = "none";

      // KRYTYCZNA POPRAWKA: Wymuszamy natychmiastowe odświeżenie okna,
      // co eliminuje problem z niewyświetlaniem się nowych postów prywatnych/restricted!
      window.location.reload(true);
    } else {
      if (loadingModal) loadingModal.style.display = "none";
      const responseText = await response.text();
      await window.Alert(responseText);
    }
  } catch (err) {
    if (loadingModal) loadingModal.style.display = "none";
    console.error("Błąd potoku operacyjnego:", err);
  }
};

// ==========================================
// 3. ASYNCHRONICZNE STRONICOWANIE POSTÓW (AJAX)
// ==========================================
let currentSkip = 5;

function loadMorePosts() {
  loadMorePostsChaser();
}

function loadMorePostsChaser() {
  return new Promise((resolve, reject) => {
    const btn = document.getElementById("load-more-btn");
    if (!btn) return resolve(false);

    btn.innerText = "Ładowanie...";
    btn.disabled = true;

    fetch(`/posts/load-more?skip=${currentSkip}`)
      .then((res) => res.json())
      .then((data) => {
        const wrapper = document.getElementById("accordion-posts-wrapper");

        if (data.html) {
          wrapper.insertAdjacentHTML("beforeend", data.html);
        }

        currentSkip += 5;
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
async function revertToDraft(postId) {
  if (
    !(await Confirm(
      "Czy na pewno chcesz wycofać ten post? Bieżący post publiczny (wraz z polubieniami i komentarzami) zostanie usunięty, a Ty otrzymasz jego kopię w formie prywatnego szkicu do reedycji.",
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

      // POPRAWKA: Jeśli backend zwrócił ID nowego szkicu prywatnego,
      // doklejamy poprawną kotwicę do adresu URL i wymuszamy natychmiastowe przeładowanie.
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

window.openReplyPostModal = async function (parentPostId, parentPostTitle) {
  const isVerified = document.body.dataset.userVerified === "true";
  const postCard =
    document.getElementById(`post-${parentPostId}`) ||
    document.querySelector(".editorial-article");
  const isPublicPost =
    postCard &&
    (postCard.innerHTML.includes('title="Publiczny"') ||
      postCard.innerHTML.includes("🌐"));

  if (window.appUser && !window.appUser.isVerified && isPublicPost) {
    await window.Alert(
      `
                <div style="text-align: left; line-height: 1.5;">
                    <p style="margin-bottom: 10px;">Próba opublikowania artykułu in odpowiedzi na <b>🌐 Wpis Publiczny</b> została wstrzymana.</p>
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

  const createPostBlock = document.getElementById("post-new");
  if (!createPostBlock) return;

  // --- Sprawdzenie czy kreator jest ukryty (kontekst single-post) ---
  const isSidebarOrHidden =
    window.getComputedStyle(createPostBlock.parentElement).display === "none";

  const accordionContent = createPostBlock.querySelector(
    ".create-accordion-content",
  );
  if (!accordionContent || accordionContent.style.display === "none") {
    window.toggleCreatePostAccordion();
  }

  const decoder = document.createElement("div");
  decoder.innerHTML = parentPostTitle;
  const decodedTitle = decoder.textContent;

  const titleField = document.getElementById("edit-title-new");
  if (titleField) {
    titleField.value = "";
    titleField.placeholder = "Dodaj tytuł polemiki";
  }

  // Dynamicznie zmieniamy podtytuł nad edytorem na informację o polemice
  const contextSubtitle = document.getElementById("create-post-context-time");
  if (contextSubtitle) {
    contextSubtitle.innerText = `Polemika z "${decodedTitle}"`;
    contextSubtitle.style.color = "#bc2525";
    contextSubtitle.style.fontWeight = "600";
  }

  // KRYTYCZNA DOSTAWKA: Pobieramy ukryte pole i wpisujemy do niego ID posta nadrzędnego
  const parentIdHiddenInput = document.getElementById("edit-parent-id-new");
  if (parentIdHiddenInput) {
    parentIdHiddenInput.value = parentPostId;
  }

  // POPRAWKA: Wymuszenie jawności krytyki i zablokowanie zmiany statusu widoczności
  const selectEl = document.getElementById("visibility-select-node");
  const warningEl = document.getElementById("public-debate-warning-badge");
  if (selectEl && warningEl) {
    selectEl.value = "public";
    selectEl.disabled = true; // Blokada wyboru na poziomie UI
    warningEl.innerText =
      "📢 Uwaga: Polemika z postem publicznym będzie widoczna dla wszystkich użytkowników serwisu.";
    warningEl.style.display = "inline-block";
  }

  // Jeśli kreator jest ukryty (jesteśmy na stronie single-post), wykonujemy asynchroniczny submit,
  // a funkcja prepareEditSubmit w api.js automatycznie przekieruje nas na stronę główną po sukcesie!
  if (!isSidebarOrHidden) {
    createPostBlock.scrollIntoView({ behavior: "smooth", block: "center" });
    if (activeQuillInstances["new"]) {
      activeQuillInstances["new"].focus();
    }
  } else {
    // Płynne i eleganckie przewinięcie ekranu do ukrytego formularza w celu otwarcia modalnego edytora
    createPostBlock.parentElement.style.display = "block";
    createPostBlock.scrollIntoView({ behavior: "smooth", block: "center" });
    if (activeQuillInstances["new"]) {
      activeQuillInstances["new"].focus();
    }
  }
};

window.removePostImage = async function (postId) {
  if (postId === "new") return;
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
      const previewContainer = document.getElementById(
        `current-image-preview-${postId}`,
      );
      if (previewContainer) previewContainer.remove();

      // Opcjonalne usunięcie elementu img z trybu widoku statycznego w locie
      const staticView = document.getElementById(`view-${postId}`);
      if (staticView) {
        const imgWrap = staticView.querySelector(".post-image-container");
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

  // Obsługa reCAPTCHA Enterprise w zależności od flagi z config.js
  if (isPublicReport && !isCaptchaEnabled) {
    formData.set("recaptchaToken", "BYPASS_TOKEN_CAPTCHA_DISABLED");
    fireReportPayload(formData);
  } else if (
    isPublicReport &&
    typeof grecaptcha !== "undefined" &&
    window.env &&
    window.env.RECAPTCHA_SITE_KEY
  ) {
    // KRYTYCZNA POPRAWKA: Korzystamy ze standardowego obiektu grecaptcha.ready i grecaptcha.execute
    grecaptcha.ready(function () {
      grecaptcha
        .execute(window.env.RECAPTCHA_SITE_KEY, { action: "submit_abuse" })
        .then(function (token) {
          formData.set("recaptchaToken", token); // Ten token będzie w 100% poprawny dla /siteverify!
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
  // 1. Wyznaczamy poprawne ID elementu input w zależności od kontekstu (kreator używa innego ID)
  const inputId =
    postId === "new" ? "editPostImage-new" : `editPostImage-${postId}`;
  const fileInput = document.getElementById(inputId);

  // 2. Czyścimy surową wartość pola input (reset binarnego bufora pliku)
  if (fileInput) {
    fileInput.value = "";
  }

  // 3. Ukrywamy kontener podglądu nowej grafiki i czyścimy jego źródło
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

  // 4. Jeśli reedycja dotyczy istniejącego wpisu, przywracamy widoczność starego zdjęcia z bazy (jeśli istniało)
  if (postId !== "new") {
    const currentPreview = document.getElementById(
      `current-image-preview-${postId}`,
    );
    if (currentPreview) {
      currentPreview.style.display = "block";
    }
  }
};

/**
 * Bezpieczne anulowanie edycji posta.
 * Sprawdza, czy w formularzu znajdują się niezapisane zmiany i ostrzega użytkownika.
 */
window.safeCancelInlineEdit = async function (postId) {
  const titleField = document.getElementById(`edit-title-${postId}`);
  const instance = activeQuillInstances[postId];

  let hasChanges = false;

  if (postId === "new") {
    // Scenariusz A: Kreator nowego posta
    const hasTitle = titleField && titleField.value.trim().length > 0;
    // Quill bez tekstu domyślnie zwraca pusty paragraf lub pojedynczy znak nowej linii
    const hasContent = instance && instance.getText().trim().length > 0;

    if (hasTitle || hasContent) {
      hasChanges = true;
    }
    const categoryWrapperReset = document.getElementById(
      "abuse-category-wrapper-new",
    );
    if (categoryWrapperReset) categoryWrapperReset.style.display = "none";
  } else {
    // Scenariusz B: Edycja istniejącego szkicu prywatnego/restricted
    const staticTitle = document.getElementById(`title-text-${postId}`);
    const staticContent = document.getElementById(`content-html-${postId}`);

    const isTitleChanged =
      titleField &&
      staticTitle &&
      titleField.value.trim() !== staticTitle.innerText.trim();

    // Porównujemy zawartość semantyczną HTML edytora z pierwotnym stanem karty
    const isContentChanged =
      instance &&
      staticContent &&
      instance.getSemanticHTML().trim() !== staticContent.innerHTML.trim();

    if (isTitleChanged || isContentChanged) {
      hasChanges = true;
    }
  }

  // Jeśli wykryto zmiany, pytamy użytkownika o zgodę na ich odrzucenie
  if (hasChanges) {
    const message =
      "Masz niezapisane zmiany w tym poście. Czy na pewno chcesz anulować edycję? Cały wpisany tekst zostanie bezpowrotnie utracony.";
    const confirmed =
      typeof window.Confirm === "function"
        ? await window.Confirm(message, "Porzucić zmiany?")
        : confirm(message);

    if (!confirmed) return; // Przerywamy anulowanie, użytkownik wraca do edycji
  }

  // Jeśli brak zmian lub użytkownik potwierdził chęć ich odrzucenia – zamykamy edytor
  if (postId === "new") {
    if (titleField) titleField.value = "";
    if (instance) instance.setContents([]);
    const previewContainer = document.getElementById(
      "edit-image-preview-container-new",
    );
    if (previewContainer) previewContainer.style.display = "none";
    const fileInput = document.getElementById("editPostImage-new");
    if (fileInput) fileInput.value = "";

    // Resetujemy podtytuł do stanu wyjściowego po zamknięciu/anulowaniu
    const contextSubtitle = document.getElementById("create-post-context-time");
    if (contextSubtitle) {
      contextSubtitle.innerText = "Tworzenie nowego wpisu";
      contextSubtitle.style.color = "#65676b";
      contextSubtitle.style.fontWeight = "normal";
    }

    // Przywrócenie pierwotnego stanu selecta oraz ukrycie odznak ostrzegawczych
    const selectResetEl = document.getElementById("visibility-select-node");
    const warningResetEl = document.getElementById(
      "public-debate-warning-badge",
    );
    if (selectResetEl && warningResetEl) {
      selectResetEl.disabled = false; // Przywracamy interaktywność
      selectResetEl.value = ""; // POPRAWKA: Ustawienie na pustą wartość zamiast wymuszonego "private"
      warningResetEl.style.display = "none";
    }

    // Usuwamy flagę zgłoszenia nadużycia, jeśli formularz był w tym trybie uruchomiony
    const abuseFlag = document.getElementById("abuse-report-flag-new");
    if (abuseFlag) abuseFlag.value = "false";

    window.toggleCreatePostAccordion();
  } else {
    window.toggleInlineEdit(postId);
  }
};

/**
 * Inicjalizuje formularz nowego wpisu danymi pobranymi z modułu Tematów Dnia AI
 * @param {string} title - Tytuł wydarzenia AI
 * @param {string} summary - Skrócona treść wiadomości AI
 */
window.initAiTopicDiscussion = function (title, summary) {
  // 1. Sprawdzamy czy użytkownik jest zalogowany (czy istnieje kreator wpisów na stronie)
  const createPostBlock = document.getElementById("post-new");

  if (!createPostBlock) {
    window.Alert(
      "🔒 Funkcja niedostępna: Aby publikować polemiki i komentarze do wydarzeń AI, musisz najpierw zalogować się do swojego konta.",
      "Autoryzacja systemu",
    );
    window.location.href = "/auth/login";
    return;
  }

  // 2. Wymuszamy otwarcie akordeonu tworzenia posta, jeśli był zwinięty
  const accordionContent = createPostBlock.querySelector(
    ".create-accordion-content",
  );
  if (!accordionContent || accordionContent.style.display === "none") {
    window.toggleCreatePostAccordion();
  }

  // 3. Wstrzykujemy tytuł polemiki do standardowego pola input
  const titleField = document.getElementById("edit-title-new");
  if (titleField) {
    titleField.value = title.trim();
  }

  // 4. Bezpiecznie wstrzykujemy treść newsa w formie eleganckiego cytatu blokowego (blockquote) do instancji Quill
  const quillInstance = activeQuillInstances["new"];
  if (quillInstance) {
    // Konstruujemy sformatowaną strukturę HTML z cytatem źródłowym AI na początku
    const formattedHtml = `<blockquote><strong>${summary.trim()}</string></blockquote>`;

    // DangerouslyPasteHTML bezpiecznie parsuje strukturę i umieszcza ją w edytorze
    quillInstance.clipboard.dangerouslyPasteHTML(formattedHtml);

    // Przenosimy kursor na sam koniec dokumentu, dając użytkownikowi natychmiastową gotowość do pisania
    setTimeout(() => {
      quillInstance.focus();
      quillInstance.setSelection(quillInstance.getLength(), 0);
    }, 100);
  }

  // 5. Płynne przewijanie ekranu do góry/wyśrodkowanie na edytorze posta
  createPostBlock.scrollIntoView({ behavior: "smooth", block: "center" });
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
