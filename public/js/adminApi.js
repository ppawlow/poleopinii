// public/js/admin.js
// =========================================================================
// LOGIKA ASYNCHRONICZNA WYŁĄCZNIE DLA PANELU ADMINISTRATORA (MODERACJA)
// =========================================================================

/**
 * Pomocnik sprawdzający, czy w sekcji pozostały jeszcze jakieś zgłoszenia.
 * Jeśli usunięto ostatnie, wstrzykuje komunikat o pustym rejestrze.
 */
function checkEmptyAbuseReports() {
  const feedContainer = document.querySelector("main.feed");
  // Szukamy kontenera, który bezpośrednio grupuje karty (pierwszy div wewnątrz main.feed)
  const wrapper = feedContainer ? feedContainer.querySelector("div") : null;

  if (wrapper && wrapper.children.length === 0) {
    wrapper.insertAdjacentHTML(
      "afterbegin",
      '<div class="no-posts" style="text-align: center; padding: 32px; color: #65676b; background: #f0f2f5; border-radius: 6px;">Aktualnie brak zarejestrowanych zgłoszeń nadużyć w systemie.</div>',
    );
  }
}

window.acceptAbuseReport = async function (reportId) {
  const confirmed =
    typeof window.Confirm === "function"
      ? await window.Confirm(
          "Czy na pewno chcesz uznać to zgłoszenie? Zakwestionowany artykuł zostanie trwale zablokowany jako 'Restricted' (autor straci możliwość powrotu do statusu publicznego), a to zgłoszenie zniknie z rejestru.",
          "Decyzja moderatorska",
        )
      : confirm("Czy chcesz uznać zgłoszenie?");

  if (!confirmed) return;

  try {
    const response = await fetch(`/admin/${reportId}/accept`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": document
          .querySelector('meta[name="csrf-token"]')
          .getAttribute("content"),
      },
    });

    if (response.ok) {
      const reportCard = document
        .getElementById(`report-content-${reportId}`)
        ?.closest(".post-card");
      if (reportCard) {
        reportCard.style.transition = "all 0.3s ease";
        reportCard.style.opacity = "0";
        reportCard.style.transform = "scale(0.95)";
        setTimeout(() => {
          reportCard.remove();
          checkEmptyAbuseReports();
        }, 300);
      } else {
        window.location.reload();
      }

      if (typeof window.Alert === "function") {
        window.Alert(
          "Zgłoszenie zostało pomyślnie rozpatrzone. Post zablokowano.",
          "Sukces",
        );
      }
    }
  } catch (err) {
    console.error("Błąd podczas akceptacji zgłoszenia:", err);
  }
};

window.rejectAbuseReport = async function (reportId) {
  const confirmed =
    typeof window.Confirm === "function"
      ? await window.Confirm(
          "Czy na pewno chcesz odrzucić to zgłoszenie jako niezasadne? Raport zniknie z rejestru, a oryginalny wpis nie zostanie objęty restrykcjami.",
          "Odrzucić zgłoszenie?",
        )
      : confirm("Czy chcesz odrzucić zgłoszenie?");

  if (!confirmed) return;

  try {
    const response = await fetch(`/admin/${reportId}/reject`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": document
          .querySelector('meta[name="csrf-token"]')
          .getAttribute("content"),
      },
    });

    if (response.ok) {
      const reportCard = document
        .getElementById(`report-content-${reportId}`)
        ?.closest(".post-card");
      if (reportCard) {
        reportCard.style.transition = "all 0.3s ease";
        reportCard.style.opacity = "0";
        reportCard.style.transform = "scale(0.95)";
        setTimeout(() => {
          reportCard.remove();
          checkEmptyAbuseReports();
        }, 300);
      } else {
        window.location.reload();
      }

      if (typeof window.Alert === "function") {
        window.Alert(
          "Zgłoszenie zostało odrzucone i zamknięte.",
          "Status zgłoszenia",
        );
      }
    }
  } catch (err) {
    console.error("Błąd podczas odrzucenia zgłoszenia:", err);
  }
};

window.executePostUnlock = async function (postId) {
  const confirmed =
    typeof window.Confirm === "function"
      ? await window.Confirm(
          "Czy na pewno chcesz zdjąć blokadę moderatorską z tego posta? Autor odzyska pełną możliwość jego ponownego upublicznienia.",
          "Zdjąć blokadę?",
        )
      : confirm("Czy chcesz zdjąć blokadę?");

  if (!confirmed) return;

  try {
    const response = await fetch(`/admin/posts/${postId}/unlock`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": document
          .querySelector('meta[name="csrf-token"]')
          .getAttribute("content"),
      },
    });

    if (response.ok) {
      const badge = document.getElementById(`unlock-badge-block-${postId}`);
      if (badge) badge.remove();
      if (typeof window.Alert === "function") {
        window.Alert(
          "🛡️ Blokada została pomyślnie zdjęta. Autor powiadomiony mailowo.",
          "Sukces",
        );
      }
    }
  } catch (err) {
    console.error("Błąd podczas zdejmowania blokady posta:", err);
  }
};

window.executeAbusePanelUnlock = async function (reportId, originalPostId) {
  const confirmed =
    typeof window.Confirm === "function"
      ? await window.Confirm(
          "Czy na pewno chcesz zdjąć blokadę moderatorską z tego posta? Autor odzyska pełną możliwość jego ponownego upublicznienia.",
          "Zdjąć blokadę?",
        )
      : confirm("Czy chcesz zdjąć blokadę?");

  if (!confirmed) return;

  try {
    const response = await fetch(`/admin/posts/${originalPostId}/unlock`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": document
          .querySelector('meta[name="csrf-token"]')
          .getAttribute("content"),
      },
    });

    if (response.ok) {
      if (typeof window.Alert === "function") {
        await window.Alert(
          "🛡️ Blokada została pomyślnie zdjęta z poziomu panelu nadużyć. Autor został powiadomiony mailowo.",
          "Sukces",
        );
      }
      window.location.reload();
    }
  } catch (err) {
    console.error("Błąd podczas zdejmowania blokady z panelu:", err);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("submit", async function (e) {
    const form = e.target;
    if (!form || !form.classList.contains("admin-approve-form")) return;

    e.preventDefault();

    const csrfToken = document
      .querySelector('meta[name="csrf-token"]')
      .getAttribute("content");

    // 1. POBIERAMY SUROWE DANE Z FORMULARZA
    const rawFormData = new FormData(form);

    // 2. KRYTYCZNA POPRAWKA: Wyciągamy numer konta, usuwamy z niego WSZYSTKIE spacje w locie
    const rawBankAccount = rawFormData.get("bankAccount") || "";
    const cleanBankAccount = String(rawBankAccount).replace(/\s+/g, "");

    // 3. Wstrzykujemy oczyszczony numer z powrotem, aby serwer dostał czyste 26 cyfr
    rawFormData.set("bankAccount", cleanBankAccount);

    // Konwertujemy na format tekstowy URL-encoded wymagany przez serwer
    const formData = new URLSearchParams(rawFormData).toString();

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: formData,
      });

      if (response.ok) {
        window.location.href = "/admin?msg=user_approved";
      } else {
        const errorText = await response.text();
        if (typeof window.Alert === "function") {
          await window.Alert(
            `<div style="text-align: left; line-height: 1.4;">
              <p style="color: #bc2525; font-weight: bold; margin-bottom: 8px;">✕ Błąd autoryzacji rachunku</p>
              <p>${errorText}</p>
             </div>`,
            "Błąd weryfikacji konta",
          );
        } else {
          alert(`Błąd weryfikacji konta:\n\n${errorText}`);
        }
      }
    } catch (err) {
      console.error("Błąd sieciowy panelu administratora:", err);
      if (typeof window.Alert === "function") {
        window.Alert(
          "Wystąpił krytyczny błąd połączenia sieciowego podczas autoryzacji przelewu.",
          "Błąd sieci",
        );
      }
    }
  });
});

$(document).ready(function () {
  const PolishLanguageConfig = {
    processing: "Trwa przetwarzanie...",
    search: "Szukaj:",
    lengthMenu: "Pokaż _MENU_ pozycji",
    info: "Pozycje od _START_ do _END_ z _TOTAL_ łącznie",
    infoEmpty: "Pozycji 0 z 0 dostępnych",
    infoFiltered: "(przefiltrowano z _MAX_ wszystkich pozycji)",
    loadingRecords: "Trwa ładowanie...",
    zeroRecords: "Nie znaleziono pasujących pozycji",
    emptyTable: "Brak danych w tabeli",
    paginate: {
      first: "Pierwsza",
      previous: "Poprzednia",
      next: "Następna",
      last: "Ostatnia",
    },
    aria: {
      sortAscending: ": aktywuj, by posortować kolumnę rosnąco",
      sortDescending: ": aktywuj, by posortować kolumnę malejąco",
    },
  };

  // Inicjalizacja tabeli użytkowników
  if ($("#usersTable").length) {
    $("#usersTable").DataTable({
      language: PolishLanguageConfig,
      pageLength: 10,
      lengthMenu: [
        [10, 25, 50, -1],
        [10, 25, 50, "Wszystkie"],
      ],
      order: [[0, "asc"]],
    });
  }

  // Inicjalizacja tabeli logów systemowych
  if ($("#logsTable").length) {
    $("#logsTable").DataTable({
      language: PolishLanguageConfig,
      pageLength: 10,
      lengthMenu: [
        [10, 25, 50, 100, -1],
        [10, 25, 50, 100, "Wszystkie"],
      ],
      order: [[0, "desc"]],
    });
  }
  // Fix szerokości kolumn DataTables po rozwinięciu ukrytego akordeonu
  $(".accordion-header[data-table-trigger]").on("click", function () {
    const tableId = $(this).data("table-trigger");

    // Dajemy 5ms opóźnienia, aby kontener zdążył zmienić display na 'block'
    setTimeout(() => {
      if ($.fn.DataTable.isDataTable("#" + tableId)) {
        $("#" + tableId)
          .DataTable()
          .columns.adjust()
          .responsive.recalc();
      }
    }, 5);
  });
  // Obsługa asynchronicznego selektora daty logów systemowych
  $("#log-date-picker").on("change", async function () {
    const selectedDate = $(this).val();
    if (!selectedDate) return;

    const tableBody = $("#logs-table-body");
    const badge = $("#admin-panel-logs .accordion-header span");

    try {
      const response = await fetch(`/admin/logs/api?date=${selectedDate}`);
      if (response.ok) {
        const data = await response.json();

        if (data.success) {
          // 1. Niszczymy starą instancję DataTables na czas podmiany drzewa DOM
          if ($.fn.DataTable.isDataTable("#logsTable")) {
            $("#logsTable").DataTable().destroy();
          }

          // 2. Wstrzykujemy nowe wiersze HTML wyrenderowane przez serwer
          tableBody.html(data.html);

          // 3. Aktualizujemy bąbelek liczbowy w nagłówku akordeonu
          if (badge.length) {
            badge.text(data.count);
          }

          // 4. Ponownie inicjalizujemy DataTables z polską konfiguracją językową
          $("#logsTable").DataTable({
            language: PolishLanguageConfig, // Korzysta z zadeklarowanej wyżej zmiennej globalnej
            pageLength: 25,
            lengthMenu: [
              [10, 25, 50, 100, -1],
              [10, 25, 50, 100, "Wszystkie"],
            ],
            order: [[0, "desc"]],
          });
        }
      }
    } catch (err) {
      console.error("Błąd sieciowy pobierania logów archiwalnych:", err);
    }
  });
});
