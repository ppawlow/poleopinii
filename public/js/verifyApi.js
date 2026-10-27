// public/js/verify.js
document.addEventListener("DOMContentLoaded", () => {
  const transferForm = document.getElementById("transferVerificationForm");
  if (transferForm) {
    transferForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const confirmed =
        typeof window.Confirm === "function"
          ? await window.Confirm(
              "Czy na pewno zleciłeś już przelew w swoim banku z podanym tytułem weryfikacyjnym?",
              "Potwierdzenie operacji bankowej",
            )
          : confirm("Czy potwierdzasz wykonanie przelewu?");

      if (!confirmed) return;
      const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        .getAttribute("content");
      const formData = new URLSearchParams(
        new FormData(transferForm),
      ).toString();
      const container = transferForm.parentElement;

      try {
        const response = await fetch(transferForm.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-Token": csrfToken,
          },
          body: formData,
        });
        if (response.ok) {
          container.innerHTML = `<div id="manual-status-container" style="text-align: center; padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #1877f2; margin-top: 12px;"><p style="font-size: 14px; font-style: italic; color: #1877f2; margin-bottom: 8px; font-weight: 600;">🏦 Zgłoszenie przelewu zostało pomyślnie zarejestrowane!</p></div>`;
          startVerificationPolling();
        }
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (
    document.body.innerText.includes(
      "Trwa dopasowywanie wpłaty w systemie bankowym",
    )
  ) {
    startVerificationPolling();
  }
});

function startVerificationPolling() {
  const intervalId = setInterval(async () => {
    try {
      const response = await fetch("/verify/status");
      if (response.ok) {
        const data = await response.json();
        if (data.transferStatus === "approved") {
          clearInterval(intervalId);
          window.location.reload();
        }
      }
    } catch (err) {}
  }, 2000);
}
