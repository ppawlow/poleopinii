// tools/mailer.js
const nodemailer = require("nodemailer");
const { SERVICE_NAME, MAIN_ADMIN_EMAIL } = require("../config");
const { renderMail } = require("./pug2html");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: process.env.SMTP_PORT || 1025,
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
 * 1. Wyślij link aktywacyjny (Rejestracja oraz Zmiana adresu e-mail)
 */
async function sendVerificationEmail(user, req) {
  const targetEmail = user.newEmailPending || user.email;
  const baseRoute = user.newEmailPending ? "verify/email" : "auth/set-password";
  const verificationLink = `${req.protocol}://${req.get("host")}/${baseRoute}/${user.token}`;

  const mailContent = renderMail("verificationEmail", {
    userName: user.name,
    verificationLink,
  });

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
  const resetLink = `${req.protocol}://${req.get("host")}/auth/set-password/${user.token}`;
  const mailContent = renderMail("passwordResetEmail", {
    serviceName: SERVICE_NAME,
    resetLink,
  });

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
  const { User } = require("./db");
  const postUrl = `${req.protocol}://${req.get("host")}/posts/${savedPost._id}`;
  
  // Bezpieczne pobranie aktualnych danych adresata bezpośrednio z jego zweryfikowanego profilu
  const originalAuthorDoc = await User.findById(originalPost.authorId).select("name");
  const realAuthorName = originalAuthorDoc ? originalAuthorDoc.name : originalPost.author;

  const mailContent = renderMail("replyNotificationEmail", {
    authorName: realAuthorName,
    senderDisplayName: dbUser.displayName || dbUser.name,
    originalTitle: originalPost.title || "Wpis bez tytułu",
    decodedTitle: savedPost.title,
    postUrl,
    serviceName: SERVICE_NAME,
  });

  // Dynamiczne ustalenie adresu e-mail odbiorcy
  const recipientEmail = originalPost.authorEmail || (originalAuthorDoc ? originalAuthorDoc.email : null);

  if (recipientEmail) {
    await sendMail(
      recipientEmail,
      `Nowa odpowiedź na Twój wpis "${originalPost.title}"`,
      mailContent,
    );
  } else {
    console.warn(`[SYSTEM MAIL] Przerwano sendReplyNotificationEmail: brak adresu e-mail dla posta o ID: ${originalPost._id}`);
  }
}


/**
 * 4. Wyślij zgłoszenie nadużycia (Do autora oraz Alert dla Administratora)
 */
async function sendAbuseReportEmail(originalPost, savedPost, req) {
  const { User } = require("./db");
  const reportUrl = `${req.protocol}://${req.get("host")}/posts/${savedPost._id}`;

  const targetAuthorDoc = await User.findById(originalPost.authorId);
  if (!targetAuthorDoc || !targetAuthorDoc.email) {
    console.warn(
      `[SYSTEM MAIL] Przerwano: Nie odnaleziono adresu e-mail dla autora o ID: ${originalPost.authorId}`,
    );
    return;
  }

  const isCopyrightInfringement = savedPost.abuseCategory === "copyright";
  const authorMailSubject = isCopyrightInfringement
    ? "🚨 PILNE: Zgłoszenie naruszenia praw autorskich Twojego wpisu"
    : "Pilne: Twój wpis został zakwestionowany (Zgłoszenie nadużycia)";

  let appendedContent = savedPost.content;
  if (isCopyrightInfringement) {
    appendedContent +=
      "<br><br><strong>⚠️ ZGŁOSZENIE DOTYCZY ŁAMANIA PRAW AUTORSKICH. Treść może zostać tymczasowo zablokowana prewencyjnie przez Administratora.</strong>";
  }

  const authorMailContent = renderMail("abuseReportEmail", {
    authorName: targetAuthorDoc.name,
    originalTitle: originalPost.title || "Wpis bez tytułu",
    reportContent: appendedContent,
    reportUrl,
    serviceName: SERVICE_NAME,
  });

  await sendMail(targetAuthorDoc.email, authorMailSubject, authorMailContent);

  // System powiadomień dla administratora platformy
  let adminMailContent;
  let adminMailSubject;

  if (isCopyrightInfringement) {
    adminMailSubject =
      "🔥 [ROZSTRZYGNIĘCIE RZECZOWE - PRAWA AUTORSKIE] Żądanie usunięcia grafiki / treści (Takedown Request)";
    adminMailContent = renderMail("adminAbuseCopyrightAlertEmail", {
      originalTitle: originalPost.title || "Wpis bez tytułu",
      reportContent: savedPost.content,
      adminUrl: `${req.protocol}://${req.get("host")}/admin`,
    });
  } else {
    adminMailSubject = "🚨 ALARM: Zgłoszono nowe nadużycie";
    adminMailContent = renderMail("adminAbuseAlertEmail", {
      authorName: targetAuthorDoc.name,
      originalTitle: originalPost.title || "Wpis bez tytułu",
      reportContent: savedPost.content,
      reportUrl: `${req.protocol}://${req.get("host")}/admin`,
    });
  }

  await sendMail(MAIN_ADMIN_EMAIL, adminMailSubject, adminMailContent);
}

/**
 * 5. Wyślij wiadomość prywatną (Komunikacja Peer-to-Peer)
 */
async function sendPrivatePeerEmail(sender, recipient, subject, message, req) {
  const senderProfileUrl = `${req.protocol}://${req.get("host")}/profile/${sender._id}`;
  const mailContent = renderMail("privateMessageEmail", {
    senderDisplayName: sender.displayName,
    senderEmail: sender.email,
    messageText: message,
    senderProfileUrl,
  });

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
  const originalAuthor = await User.findById(originalPost.authorId);

  if (originalAuthor && originalAuthor.email) {
    const authorMailContent = renderMail("authorLockedNotificationEmail", {
      authorName: originalAuthor.name,
      originalTitle: originalPost.title || "Wpis bez tytułu",
      reportContent: reportPost.content,
      serviceName: SERVICE_NAME,
    });
    await sendMail(
      originalAuthor.email,
      "⚠️ Ważne: Twój wpis został ograniczony przez moderatora",
      authorMailContent,
    );
  }

  if (reportPost.authorEmail) {
    const reporterMailContent = renderMail("reporterResolutionEmail", {
      originalTitle: originalPost ? originalPost.title : "Zakwestionowany wpis",
      serviceName: SERVICE_NAME,
    });
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
  const originalAuthor = await User.findById(originalPost.authorId);

  if (reportPost.authorEmail) {
    const rejectMailContent = renderMail("abuseReportRejectedEmail", {
      originalTitle: originalPost ? originalPost.title : "Zakwestionowany wpis",
      serviceName: SERVICE_NAME,
    });
    await sendMail(
      reportPost.authorEmail,
      "Status zgłoszenia: Odrzucone (Brak nadużycia)",
      rejectMailContent,
    );
  }

  if (originalAuthor && originalAuthor.email) {
    const clearedMailContent = renderMail("authorClearedEmail", {
      authorName: originalAuthor.name,
      originalTitle: originalPost.title || "Wpis bez tytułu",
      serviceName: SERVICE_NAME,
    });
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
    const unlockMailContent = renderMail("authorUnlockNotificationEmail", {
      authorName: post.author,
      originalTitle: post.title || "Wpis bez tytułu",
      serviceName: SERVICE_NAME,
    });
    await sendMail(
      post.authorEmail,
      "🔓 Odblokowanie profilu: Możesz ponownie upublicznić post",
      unlockMailContent,
    );
  }
}

async function sendVerificationSuccessEmail(user) {
  const mailContent = renderMail("verificationSuccessEmail", {
    userName: user.name,
    serviceName: SERVICE_NAME,
  });
  await sendMail(
    user.email,
    "Twój profil został pomyślnie zweryfikowany! 🎉",
    mailContent,
  );
}

async function sendVerificationRejectedEmail(user, adminComment) {
  const mailContent = renderMail("verificationRejectedEmail", {
    userName: user.name,
    adminComment,
    serviceName: SERVICE_NAME,
  });
  await sendMail(
    user.email,
    "Ważne: Decyzja w sprawie weryfikacji Twojego profilu",
    mailContent,
  );
}

async function sendAccountDeletionRequestEmail(user, req) {
  const deletionLink = `${req.protocol}://${req.get("host")}/profile/settings/confirm-delete/${user.token}`;
  const mailContent = renderMail("accountDeletionRequestEmail", {
    userName: user.name,
    deletionLink,
    serviceName: SERVICE_NAME,
  });

  await sendMail(
    user.email,
    "Ważne: Potwierdzenie usunięcia konta (Wniosek RODO)",
    mailContent,
  );
}

async function sendAccountDeletionSuccessNotification(userName, userEmail) {
  const mailContent = renderMail("accountDeletionSuccessNotification", {
    userName,
    serviceName: SERVICE_NAME,
  });

  await sendMail(
    userEmail,
    "Potwierdzenie usunięcia danych z systemu 🎉",
    mailContent,
  );
}

async function sendEditorCandidateEmail(user, totalLikes) {
  const mailContent = renderMail("editorCandidateEmail", {
    userName: user.name,
    serviceName: SERVICE_NAME,
    totalLikes,
  });
  await sendMail(
    user.email,
    "Spełniłeś warunki formalne: Jesteś Kandydatem na Redaktora! ⏳",
    mailContent,
  );
}

async function sendEditorApprovedByBoardEmail(user) {
  const mailContent = renderMail("editorApprovedByBoardEmail", {
    userName: user.name,
    serviceName: SERVICE_NAME,
  });
  await sendMail(
    user.email,
    "Oficjalna decyzja Kolegium: Zostałeś mianowany Redaktorem Serwisu! 🌟",
    mailContent,
  );
}
async function sendNewEditorPostNotification(senderUser, savedPost, req) {
  const { User } = require("./db");
  try {
    const activeEditors = await User.find({
      role: "editor",
      _id: { $ne: senderUser._id },
    })
      .select("email")
      .lean();
    if (!activeEditors || activeEditors.length === 0) return;
    const postUrl = `${req.protocol}://${req.get("host")}/editors`;
    const mailContent = renderMail("newEditorPostEmail", {
      editorName: senderUser.displayName,
      postTitle: savedPost.title || "Wpis bez tytułu",
      postUrl,
      serviceName: SERVICE_NAME,
    });
    const emailPromises = activeEditors.map((editor) => {
      if (editor.email) {
        return sendMail(
          editor.email,
          `[KOLEGIUM] Nowy temat narad redakcji: "${savedPost.title}"`,
          mailContent,
        );
      }
    });
    await Promise.all(emailPromises);
    console.log(
      `[SYSTEM MAIL] Rozesłano powiadomienie do ${activeEditors.length} redaktorów.`,
    );
  } catch (err) {
    console.error("Krytyczny błąd rozsyłania mailingu do redaktorów:", err);
  }
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
  sendEditorCandidateEmail,
  sendEditorApprovedByBoardEmail,
  sendNewEditorPostNotification,
};
