// public/js/editorsApi.js

/**
 * Asynchroniczne zlecenie wygenerowania profesjonalnego szkicu artykułu prasowego na bazie newsa AI
 */
window.generatePressArticleFromTopic = async function (topicId, buttonElement) {
  if (!topicId || !buttonElement) return;

  // Zabezpieczenie przed double-click
  if (buttonElement.dataset.loading === "true") return;
  buttonElement.dataset.loading = "true";

  const originalText = buttonElement.innerHTML;
  buttonElement.disabled = true;
  buttonElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generowanie...';

  const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  
  // Pobieramy instancje globalnego loadera (SSE-compatible z modal.pug)
  const loadingModal = document.getElementById("custom-loading-modal");
  const loaderHeading = document.getElementById("loader-status-heading");
  const loaderText = document.getElementById("loader-status-text");

  if (loadingModal) {
    if (loaderHeading) loaderHeading.innerText = "🤖 Sztuczna Inteligencja pisze artykuł";
    if (loaderText) loaderText.innerText = "Trwa zaawansowana analiza wątku prasowego, formatowanie struktury tekstu dziennikarskiego oraz budowanie akapitów. Proszę nie zamykać strony...";
    loadingModal.style.display = "flex";
  }

  try {
    const response = await fetch(`/editors/topics/${topicId}/generate-article`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrfToken,
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        if (loadingModal) loadingModal.style.display = "none";
        
        // Wyświetlamy sukces i dajemy redaktorowi link do natychmiastowego przejścia do nowo powstałego szkicu
        await window.Alert(
          `<div style="text-align: left; line-height: 1.5;">
            <p style="color: #146c43; font-weight: bold; margin-bottom: 8px;">🟢 Szkic wygenerowany pomyślnie!</p>
            <p>${data.message}</p>
            <hr style="border:0; border-top:1px solid #dddfe2; margin:12px 0;">
            <p style="font-size:13px; color:#65676b;">Możesz go teraz sprawdzić, nanieść poprawki redakcyjne i uzupełnić w edytorze Quill na swoim profilu.</p>
           </div>`, 
          "Kolegium AI"
        );

        // Przekierowujemy redaktora bezpośrednio na jego oś czasu/profil z kotwicą do tego posta
        window.location.href = `/#post-${data.postId}`;
      }
    } else {
      if (loadingModal) loadingModal.style.display = "none";
      const errText = await response.text();
      window.Alert(`Nie udało się wygenerować artykułu: ${errText}`, "Błąd generatora");
    }
  } catch (err) {
    console.error("Błąd sieciowy potoku generowania tekstu:", err);
    if (loadingModal) loadingModal.style.display = "none";
    window.Alert("Wystąpił błąd połączenia z serwerem AI.", "Błąd sieci");
  } finally {
    buttonElement.dataset.loading = "false";
    buttonElement.disabled = false;
    buttonElement.innerHTML = originalText;
  }
};

/**
 * Asynchroniczne wywołanie odizolowanej weryfikacji faktograficznej dla wpisu autora (Asysta AI)
 * Zoptymalizowane pod kątem czytelności i przewijania długich raportów (WCAG / Mobile UX)
 */
window.executeEditorFactCheck = async function (postId, buttonElement) {
  if (!postId || !buttonElement) return;

  const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  const loadingModal = document.getElementById("custom-loading-modal");
  const loaderHeading = document.getElementById("loader-status-heading");
  const loaderText = document.getElementById("loader-status-text");

  // Konfiguracja loadera w tryb analityczny
  if (loadingModal) {
    if (loaderHeading) loaderHeading.innerText = "🔍 Trwa weryfikacja faktów (Asysta AI)";
    if (loaderText) loaderText.innerText = "Sztuczna inteligencja analizuje treść artykułu pod kątem poprawności danych historycznych, nazwisk oraz statystyk, weryfikując je w wyszukiwarki Google Search. Proszę czekać...";
    loadingModal.style.display = "flex";
  }

  try {
    const response = await fetch(`/editors/posts/${postId}/check`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrfToken,
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (loadingModal) loadingModal.style.display = "none";

      // NOWOŚĆ: Ponieważ data.report zawiera skompilowany i ustrukturyzowany HTML, 
      // wstrzykujemy go bezpośrednio bez operacji string-buildera na froncie.
      await window.Alert(data.report, "📋 Raport Fact-Checking AI");
    } else {
      if (loadingModal) loadingModal.style.display = "none";
      const errText = await response.text();
      window.Alert(`Nie udało się przeprowadzić analizy: ${errText}`, "Błąd analityki");
    }
  } catch (err) {
    console.error("Błąd sieciowy asysty AI:", err);
    if (loadingModal) loadingModal.style.display = "none";
    window.Alert("Wystąpił błąd połączenia z serwerem analitycznym.", "Błąd sieci");
  }
};

/**
 * Asynchroniczne usuwanie tematu dnia przez uprawnionego Redaktora/Administratora
 */
window.executeAdminDeleteTopic = async function (topicId, topicTitle) {
  const confirmed = typeof window.Confirm === "function"
    ? await window.Confirm(`Czy na pewno chcesz usunąć temat dnia: "${topicTitle}"?`, "Usuwanie wiadomości AI")
    : confirm(`Czy chcesz usunąć temat: "${topicTitle}"?`);

  if (!confirmed) return;

  const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute("content");

  try {
    const response = await fetch(`/editors/topics/${topicId}`, {
      method: "DELETE",
      headers: {
        "X-CSRF-Token": csrfToken,
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    if (response.ok) {
      const targetButton = document.querySelector(`button[onclick*="${topicId}"]`);
      const newsCard = targetButton ? targetButton.closest(".post-card") : null;

      if (newsCard) {
        newsCard.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
        newsCard.style.opacity = "0";
        newsCard.style.transform = "scale(0.95)";
        
        setTimeout(() => {
          newsCard.remove();
          
          const accordionContainer = document.querySelector(".right-sidebar .accordion-container");
          if (accordionContainer && accordionContainer.children.length === 0) {
            accordionContainer.insertAdjacentHTML(
              "afterbegin",
              '<div class="no-posts" style="text-align: center; padding: 32px; color: #65676b; background: #fff; border-radius: 8px; font-size: 13px; border: 1px dashed var(--border-color);">⏳ Tematy zostały wyczyszczone.</div>'
            );
          }
        }, 300);
      } else {
        window.location.reload();
      }
    } else {
      const errText = await response.text();
      if (typeof window.Alert === "function") {
        window.Alert(`Nie udało się usunąć komunikatu: ${errText}`, "Błąd uprawnień");
      }
    }
  } catch (err) {
    console.error("Błąd sieciowy podczas usuwania komunikatu AI:", err);
    if (typeof window.Alert === "function") {
      window.Alert("Wystąpił błąd połączenia sieciowego podczas próby usunięcia zasobu.", "Błąd sieci");
    }
  }
};

/**
 * Osłona przed przypadkowym uruchomieniem weryfikacji faktograficznej AI (Ochrona kosztów tokenów)
 */
window.executeEditorFactCheckWithConfirm = async function (postId, buttonElement) {
  if (!postId || !buttonElement) return;

  // Wykorzystujemy systemowy uniwersalny modal Confirm (SPA-friendly)
  const message = "Uwaga: Ta operacja uruchamia zaawansowany proces weryfikacji danych z użyciem zasobów sztucznej inteligencji Gemini oraz silnika Google Search Grounding. Czy chcesz kontynuować analizę tego artykułu?";
  
  const confirmed = typeof window.Confirm === "function"
    ? await window.Confirm(message, "Uruchomić Fact-Checking AI?")
    : confirm(message);

  if (!confirmed) return; // Kliknięto "Anuluj" - zapytanie nie zostanie wysłane

  // Przekazujemy sterowanie do zaimplementowanej wcześniej metody analitycznej
  if (typeof window.executeEditorFactCheck === "function") {
    window.executeEditorFactCheck(postId, buttonElement);
  }
};
