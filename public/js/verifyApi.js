// public/js/verifyApi.js
document.addEventListener("DOMContentLoaded", () => {
  const transferForm = document.getElementById("transferVerificationForm");

  if (transferForm) {
    transferForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (transferForm.dataset.loading === "true") return;

      const confirmed =
        typeof window.Confirm === "function"
          ? await window.Confirm(
              "Czy na pewno zleciłeś już przelew w swoim banku z podanym tytułem weryfikacyjnym?",
              "Potwierdzenie operacji bankowej",
            )
          : confirm("Czy potwierdzasz wykonanie przelewu?");

      if (!confirmed) return;

      const submitBtn = transferForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.innerText : "";

      transferForm.dataset.loading = "true";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Zapisywanie...";
        submitBtn.style.opacity = "0.7";
      }

      const csrfToken =
        document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
        transferForm.querySelector('input[name="_csrf"]')?.value ||
        "";

      const formData = new URLSearchParams(
        new FormData(transferForm),
      ).toString();
      const container = transferForm.parentElement;

      try {
        const response = await fetch(transferForm.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-Token": csrfToken,
          },
          body: formData,
        });

        if (response.ok) {
          container.innerHTML = `
            <div id="manual-status-container" style="text-align: center; padding: 16px; background: var(--alert-info-bg, #e7f3ff); border-radius: 6px; border: 1px solid #1877f2; margin-top: 12px;">
              <p style="font-size: 14px; font-style: italic; color: #1877f2; margin-bottom: 0; font-weight: 600;">
                🏦 Zgłoszenie przelewu zostało pomyślnie zarejestrowane! Oczekujemy na zaksięgowanie wpłaty przez administratora.
              </p>
            </div>`;
          startVerificationPolling();
        } else {
          let errorMessage = "Nie udało się zapisać potwierdzenia przelewu.";
          const contentType = response.headers.get("content-type") || "";

          if (contentType.includes("application/json")) {
            const errData = await response.json().catch(() => ({}));
            if (errData.error) errorMessage = errData.error;
          } else {
            const errText = await response.text().catch(() => "");
            if (errText) errorMessage = errText;
          }

          if (typeof window.Alert === "function") {
            await window.Alert(errorMessage, "Błąd weryfikacji");
          } else {
            alert(errorMessage);
          }
        }
      } catch (err) {
        console.error("Błąd sieciowy podczas potwierdzania przelewu:", err);
        const netErr = "Wystąpił błąd połączenia z serwerem. Spróbuj ponownie.";
        if (typeof window.Alert === "function") {
          await window.Alert(netErr, "Błąd sieci");
        } else {
          alert(netErr);
        }
      } finally {
        transferForm.dataset.loading = "false";
        if (submitBtn && document.body.contains(submitBtn)) {
          submitBtn.disabled = false;
          submitBtn.innerText = originalBtnText;
          submitBtn.style.opacity = "";
        }
      }
    });
  }

  // Automatyczne uruchamianie pollingu, gdy użytkownik odświeży stronę w trakcie oczekiwania
  if (document.body.innerText.includes("TRWA WERYFIKACJA")) {
    startVerificationPolling();
  }
});

let pollingIntervalId = null;

function startVerificationPolling() {
  if (pollingIntervalId) return;

  pollingIntervalId = setInterval(async () => {
    try {
      const response = await fetch("/verify/status", {
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.transferStatus === "approved") {
          clearInterval(pollingIntervalId);
          pollingIntervalId = null;
          window.location.reload();
        }
      }
    } catch (err) {
      // Ignorujemy chwilowe przerwy sieciowe podczas pollingu
    }
  }, 4000);
}
