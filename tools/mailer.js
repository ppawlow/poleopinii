// tools/mailer.js
const nodemailer = require("nodemailer");
const { SERVICE_NAME, MAIN_ADMIN_EMAIL } = require("../config");
const mailTemplates = require("./mailTemplates");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: process.env.SMTP_PORT || 1025, // Mailpit / Mailhog dla developmentu
  auth: {
    user: process.env.SMTP_USER || "user",
    pass: process.env.SMTP_PASS || "password",
  },
});

/**
 * Główna, zcentralizowana i prywatna metoda wysyłki SMTP
 */
async function sendMail(recpt, subject, content, replyTo = null) {
  try {
    const mailOptions = {
      from: `${SERVICE_NAME} <${process.env.SMTP_USER || "user"}>`,
      to: recpt,
      subject: `[${SERVICE_NAME}] ` + subject,
      html: content,
      text: content.replace(/<\/?[^>]+>/g, ""),
    };

    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }

    return await transporter.sendMail(mailOptions);
  } catch (e) {
    console.error(`[BŁĄD SMTP SERWERA]: ${e}`);
  }
}

/**
 * Powiadomienie o uruchomieniu serwera aplikacyjnego
 */
async function startNotification() {
  const to = MAIN_ADMIN_EMAIL;
  const subject = "Uruchomienie serwera";
  const now = new Date().toLocaleString("pl-PL");
  const content = `<p>Serwer uruchomiono ${now}</p>`;
  return await sendMail(to, subject, content);
}

/**
 * 1. Wyślij link aktywacyjny (Rejestracja oraz Ponowna prośba o aktywację)
 */
/**
 * 1. Wyślij link aktywacyjny (Rejestracja oraz Zmiana adresu e-mail)
 */
async function sendVerificationEmail(user, req) {
  const targetEmail = user.newEmailPending || user.email;

  // Jeśli użytkownik ma ustawione newEmailPending, to znaczy, że tylko zmienia maila w settings
  const baseRoute = user.newEmailPending ? "verify/email" : "auth/set-password";
  const verificationLink = `${req.protocol}://${req.get("host")}/${baseRoute}/${user.token}`;

  const mailContent = mailTemplates.getVerificationEmail(
    user.name,
    verificationLink,
  );
  await sendMail(
    targetEmail,
    "Weryfikacja adresu e-mail i aktywacja konta",
    mailContent,
  );
}

/**
 * 2. Wyślij link resetujący hasło (Zapomniane hasło z ekranu logowania)
 */
async function sendPasswordResetEmail(user, req) {
  // POPRAWKA: Łączymy mechanizmy - link kieruje na zunifikowaną trasę /auth/set-password
  const resetLink = `${req.protocol}://${req.get("host")}/auth/set-password/${user.token}`;
  const mailContent = mailTemplates.getPasswordResetEmail(
    SERVICE_NAME,
    resetLink,
  );

  await sendMail(user.email, "Resetowanie/zmiana hasła dostępu", mailContent);
}
/**
 * 3. Wyślij powiadomienie o nowej polemice (Odpowiedź nowym artykułem)
 */
async function sendReplyNotificationEmail(
  dbUser,
  req,
  originalPost,
  savedPost,
) {
  const reportUrl = `${req.protocol}://${req.get("host")}/posts/${savedPost._id}`;
  const mailContent = mailTemplates.getReplyNotificationEmail(
    originalPost.author,
    dbUser.displayName,
    originalPost.title || "Wpis bez tytułu",
    savedPost.title,
    reportUrl,
    SERVICE_NAME,
  );

  await sendMail(
    originalPost.authorEmail,
    `Nowa odpowiedź na Twój wpis "${originalPost.title}"`,
    mailContent,
  );
}

/**
 * 4. Wyślij zgłoszenie nadużycia (Do autora oraz Alert dla Administratora)
 */
async function sendAbuseReportEmail(originalPost, savedPost, req) {
  const { User } = require("./db");
  const reportUrl = `${req.protocol}://${req.get("host")}/posts/${savedPost._id}`;

  // Dynamiczne pobranie najświeższych danych autora zaskarżonego posta z kolekcji Users
  const targetAuthorDoc = await User.findById(originalPost.authorId);
  if (!targetAuthorDoc || !targetAuthorDoc.email) {
    console.warn(
      `[SYSTEM MAIL] Przerwano: Nie odnaleziono poprawnego adresu e-mail dla autora o ID: ${originalPost.authorId}`,
    );
    return;
  }

  const isCopyrightInfringement = savedPost.abuseCategory === "copyright";

  // Wyznaczamy dedykowany temat wiadomości w zależności od stopnia ryzyka
  const authorMailSubject = isCopyrightInfringement
    ? "🚨 PILNE: Zgłoszenie naruszenia praw autorskich Twojego wpisu"
    : "Pilne: Twój wpis został zakwestionowany (Zgłoszenie nadużycia)";

  const authorMailContent = mailTemplates.getAbuseReportEmail(
    targetAuthorDoc.name,
    originalPost.title || "Wpis bez tytułu",
    savedPost.content +
      (isCopyrightInfringement
        ? "<br><br><strong>⚠️ ZGŁOSZENIE DOTYCZY ŁAMANIA PRAW AUTORSKICH. Treść może zostać tymczasowo zablokowana prewencyjnie przez Administratora.</strong>"
        : ""),
    reportUrl,
    SERVICE_NAME,
  );

  await sendMail(targetAuthorDoc.email, authorMailSubject, authorMailContent);

  // --- POWIADOMIENIE ALARMOWE DLA GŁÓWNEGO ADMINISTRATORA (NOTICE AND TAKEDOWN) ---
  const adminMailSubject = isCopyrightInfringement
    ? "🔥 [ROZSTRZYGNIĘCIE RZECZOWE - PRAWA AUTORSKIE] Żądanie usunięcia grafiki / treści (Takedown Request)"
    : "🚨 ALARM: Zgłoszono nowe nadużycie";

  const adminMailContent = `
    <div style="font-family: sans-serif; padding: 20px; border: 2px solid #bc2525; border-radius: 8px; max-width: 600px; background: #fffdfd;">
      <h2 style="color: #bc2525; margin-top: 0;">${isCopyrightInfringement ? "🔥 PILNE ŻĄDANIE TAKEDOWN (RODO/COPYRIGHT)" : "🚨 Nowe zgłoszenie nadużycia"}</h2>
      <p>Administratorze,</p>
      <p>Odnotowano zgłoszenie nadużycia wobec wpisu pt. <strong>"${originalPost.title || "Wpis bez tytułu"}"</strong>.</p>
      <p><strong>Typ zgłoszenia:</strong> ${isCopyrightInfringement ? "<span style='color:red; font-weight:bold;'>NARUSZENIE WŁASNOŚCI INTELEKTUALNEJ / PRAW AUTORSKICH</span>" : "Ogólne naruszenie zasad"}</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p><strong>Uzasadnienie zgłoszenia:</strong></p>
      <div style="background: #fff3f3; padding: 12px; border-radius: 6px; border-left: 4px solid #bc2525; color: #050505; font-style: italic;">
        ${savedPost.content}
      </div>
      <p style="font-size: 13px; color: #65676b; margin-top: 12px;">
        ${isCopyrightInfringement ? "⚠️ Zgodnie z doktryną <em>Safe Harbor</em>, jako Administrator powinieneś bezzwłocznie przeanalizować zgłoszenie i zabezpieczyć system przed zarzutem współudziału w naruszeniu." : "Sprawa podlega standardowej procedurze 3 dni wyczekiwania na obronę autora."}
      </p>
      <p style="margin-top: 20px; text-align: center;">
        <a href="${req.protocol}://${req.get("host")}/admin" style="display: inline-block; background: #bc2525; color: white; padding: 10px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Przejdź do Centrum Zarządzania</a>
      </p>
    </div>
  `;

  await sendMail(MAIN_ADMIN_EMAIL, adminMailSubject, adminMailContent);
}

/**
 * 5. Wyślij wiadomość prywatną (Komunikacja między użytkownikami typu Peer-to-Peer)
 */
async function sendPrivatePeerEmail(sender, recipient, subject, message, req) {
  const senderProfileUrl = `${req.protocol}://${req.get("host")}/profile/${sender._id}`;
  const mailContent = mailTemplates.getPrivateMessageEmail(
    sender.displayName,
    sender.email,
    message,
    senderProfileUrl,
  );

  await sendMail(
    recipient.email,
    `Prywatna wiadomość: ${subject}`,
    mailContent,
    sender.email,
  );
}

/**
 * 6. Wyślij decyzję podjętą przez moderatora (Akceptacja zgłoszenia nadużycia)
 */
async function sendAbuseReportAcceptedEmails(originalPost, reportPost) {
  const { User } = require("./db");

  // Pobieramy aktualny e-mail autora oryginalnego wpisu
  const originalAuthor = await User.findById(originalPost.authorId);

  // A. Ostrzeżenie i powiadomienie o restrykcjach dla autora naruszenia
  if (originalAuthor && originalAuthor.email) {
    const authorMailContent = mailTemplates.getAuthorLockedNotificationEmail(
      originalAuthor.name,
      originalPost.title || "Wpis bez tytułu",
      reportPost.content,
      SERVICE_NAME,
    );
    await sendMail(
      originalAuthor.email,
      "⚠️ Ważne: Twój wpis został ograniczony przez moderatora",
      authorMailContent,
    );
  }

  // B. Informacja zwrotna dla sygnalisty (osoby zgłaszającej)
  if (reportPost.authorEmail) {
    const reporterMailContent = mailTemplates.getReporterResolutionEmail(
      originalPost ? originalPost.title : "Zakwestionowany wpis",
      SERVICE_NAME,
    );
    await sendMail(
      reportPost.authorEmail,
      "Twój raport został rozpatrzony (Interwencja Moderatora)",
      reporterMailContent,
    );
  }
}

/**
 * 7. Wyślij decyzję o odrzuceniu zgłoszenia nadużycia (Oddalenie zarzutów)
 */
async function sendAbuseReportRejectedEmails(originalPost, reportPost) {
  const { User } = require("./db");

  // Pobieramy aktualny e-mail autora oryginalnego wpisu
  const originalAuthor = await User.findById(originalPost.authorId);

  // A. Informacja dla zgłaszającego (sygnalisty) o odrzuceniu raportu
  if (reportPost.authorEmail) {
    const rejectMailContent = mailTemplates.getAbuseReportRejectedEmail(
      originalPost ? originalPost.title : "Zakwestionowany wpis",
      SERVICE_NAME,
    );
    await sendMail(
      reportPost.authorEmail,
      "Status zgłoszenia: Odrzucone (Brak nadużycia)",
      rejectMailContent,
    );
  }

  // B. Informacja dla autora, że sprawa została zamknięta na jego korzyść
  if (originalAuthor && originalAuthor.email) {
    const clearedMailContent = mailTemplates.getAuthorClearedEmail(
      originalAuthor.name,
      originalPost.title || "Wpis bez tytułu",
      SERVICE_NAME,
    );
    await sendMail(
      originalAuthor.email,
      "Status zgłoszenia: Zarzuty oddalone",
      clearedMailContent,
    );
  }
}

/**
 * 8. Wyślij powiadomienie o zdjęciu blokady moderatorskiej z wpisu
 */
async function sendPostUnlockedNotificationEmail(post) {
  if (post.authorEmail) {
    const unlockMailContent = mailTemplates.getAuthorUnlockNotificationEmail(
      post.author,
      post.title || "Wpis bez tytułu",
      SERVICE_NAME,
    );
    await sendMail(
      post.authorEmail,
      "🔓 Odblokowanie profilu: Możesz ponownie upublicznić post",
      unlockMailContent,
    );
  }
}

async function sendVerificationSuccessEmail(user) {
  const mailContent = mailTemplates.getVerificationSuccessEmail(
    user.name,
    SERVICE_NAME,
  );
  await sendMail(
    user.email,
    "Twój profil został pomyślnie zweryfikowany! 🎉",
    mailContent,
  );
}

async function sendVerificationRejectedEmail(user, adminComment) {
  const mailContent = mailTemplates.getVerificationRejectedEmail(
    user.name,
    adminComment,
    SERVICE_NAME,
  );
  await sendMail(
    user.email,
    "Ważne: Decyzja w sprawie weryfikacji Twojego profilu",
    mailContent,
  );
}

/**
 * Wysyła 24-godzinny link bezpieczeństwa autoryzujący usunięcie profilu
 */
async function sendAccountDeletionRequestEmail(user, req) {
  const deletionLink = `${req.protocol}://${req.get("host")}/profile/settings/confirm-delete/${user.token}`;
  const mailContent = mailTemplates.getAccountDeletionRequestEmail(
    user.name,
    deletionLink,
    SERVICE_NAME,
  );

  await sendMail(
    user.email,
    "Ważne: Potwierdzenie usunięcia konta (Wniosek RODO)",
    mailContent,
  );
}

/**
 * Wysyła ostateczny certyfikat wymazania danych z bazy platformy
 */
async function sendAccountDeletionSuccessNotification(userName, userEmail) {
  const mailContent = mailTemplates.getAccountDeletionSuccessNotification(
    userName,
    SERVICE_NAME,
  );

  await sendMail(
    userEmail,
    "Potwierdzenie usunięcia danych z systemu 🎉",
    mailContent,
  );
}

module.exports = {
  startNotification,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendReplyNotificationEmail,
  sendAbuseReportEmail,
  sendPrivatePeerEmail,
  sendAbuseReportAcceptedEmails,
  sendAbuseReportRejectedEmails,
  sendPostUnlockedNotificationEmail,
  sendVerificationSuccessEmail,
  sendVerificationRejectedEmail,
  sendAccountDeletionRequestEmail,
  sendAccountDeletionSuccessNotification,
};
