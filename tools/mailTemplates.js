// tools/mailTemplates.js
const sanitizeHtml = require("sanitize-html");
const html = {};
module.exports = html;
/**
 * Szablon weryfikacji nowego adresu e-mail
 */
html.getVerificationEmail = (userName, verificationLink) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #e4e6eb; border-radius: 8px; max-width: 600px;">
      <p>Witaj <b>${userName}</b>!</p>
      <p>Kliknij w poniższy link, aby zweryfikować swój adres e-mail i ustawić hasło dostępu:</p>
      <p><a href="${verificationLink}" style="color: #1877f2; font-weight: bold; text-decoration: underline;">${verificationLink}</a></p>
      <p>
      Po zalogowaniu uzyskasz bezpłatny dostęp do przeglądania i testowania platformy. W panelu konta będzie czekać na Ciebie opcjonalny, <b>drugi etap weryfikacji tożsamości</b> (zwrotny przelew 1 PLN), który chroni naszą społeczność przed botami i odblokowuje pełne możliwości publicznej publicystyki. Zachęcamy do wykonania tej weryfikacji, aby w pełni korzystać z możliwości platformy.
      <p>
    </div>
  `;

/**
 * Szablon prośby o reset/zmianę hasła dostępu
 */
html.getPasswordResetEmail = (serviceName, resetLink) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #e4e6eb; border-radius: 8px; max-width: 600px;">
      <p>Dzień dobry,</p>
      <p>Zarejestrowaliśmy prośbę o zresetowanie/zmianę hasła. Jeśli to nie było Twoją intencją, zignoruj tę wiadomość. Jeśli jednak chcesz ustawić nowe hasło, kliknij w poniższy link:</p>
      <p><a href="${resetLink}" style="color: #1877f2; font-weight: bold; text-decoration: underline;">${resetLink}</a></p>
      <p>Pozdrawiamy,<br>Zespół ${serviceName}</p>
    </div>
  `;

/**
 * Szablon bezpiecznego zgłoszenia nadużycia (Anti-Phishing)
 */
html.getAbuseReportEmail = (
  authorName,
  originalTitle,
  reportContent,
  reportUrl,
  serviceName,
) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f5c6cb; border-radius: 8px; max-width: 600px;">
      <h2 style="color: #bc2525; margin-top: 0;">⚠️ Twój wpis został zakwestionowany</h2>
      <p>Dzień dobry,</p>
      <p>Informujemy, że użytkownik platformy zgłosił nadużycie wobec Twojego publicznego wpisu zatytułowanego: <b>"${originalTitle}"</b>.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p><b>Powód zgłoszenia / Treść zarzutów:</b></p>
      <div style="background: #fff3f3; padding: 12px; border-radius: 6px; border-left: 4px solid #bc2525; font-style: italic; color: #050505;">
        ${reportContent}
      </div>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-weight: bold; color: #bc2525;">🚨 WAŻNE: Masz 3 dni (72 godziny) na odniesienie się do zarzutów!</p>
      <p>Prosimy o zapoznanie się ze szczegółami i opublikowanie swojego stanowiska/obrony w sekcji komentarzy pod poniższym zgłoszeniem w wyznaczonym terminie. Po tym czasie sprawa zostanie przekazana do ostatecznego werdyktu Administratora.</p>
      <p style="margin-top: 20px; text-align: center;">
        <a href="${reportUrl}" style="display: inline-block; background: #bc2525; color: white; padding: 10px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Przejdź do zgłoszenia nadużycia</a>
      </p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 24px 0 16px 0;">
      <p style="font-size: 12px; color: #65676b; margin: 0;">Wiadomość wygenerowana automatycznie przez system ${serviceName}. Tożsamość osoby zgłaszającej pozostaje całkowicie poufna.</p>
    </div>
  `;

/**
 * Szablon standardowego powiadomienia o nowej polemice / odpowiedzi postem
 */
html.getReplyNotificationEmail = (
  authorName,
  senderDisplayName,
  originalTitle,
  decodedTitle,
  postUrl,
  serviceName,
) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #e4e6eb; border-radius: 8px; max-width: 600px;">
      <p>Dzień dobry, <b>${authorName}</b>!</p>
      <p>Użytkownik <b>${senderDisplayName}</b> właśnie opublikował nowy post w odpowiedzi na Twój artykuł pt. <i>"${originalTitle}"</i>.</p>
      <p>Tytuł odpowiedzi: <b>"${decodedTitle}"</b></p>
      <p>Aby przeczytać pełną treść odpowiedzi i dołączyć do dyskusji, kliknij w poniższy link:</p>
      <p><a href="${postUrl}" style="color: #1877f2; font-weight: bold; text-decoration: underline;">${postUrl}</a></p>
      <p>Pozdrawiamy,<br>Zespół ${serviceName}</p>
    </div>
  `;

/**
 * Szablon anonimowej prywatnej wiadomości e-mail (Anti-Phishing)
 */
html.getPrivateMessageEmail = (
  senderDisplayName,
  senderEmail,
  messageText,
  senderProfileUrl,
) => `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e4e6eb; border-radius: 8px; overflow: hidden;">
      <div style="background: #fff3f3; border-bottom: 1px solid #f5c6cb; padding: 12px 16px; font-size: 13px; color: #bc2525; font-weight: bold; line-height: 1.5;">
        ⚠️ OSTRZEŻENIE PRZED WYŁUDZENIAMI (ANTI-PHISHING):<br>
        <span style="font-weight: normal; color: #555;">
          Ta wiadomość została wygenerowana przez zewnętrznego użytkownika platformy. Administracja serwisu <b>nigdy</b> nie prosi o podawanie haseł, kodów autoryzacyjnych ani danych do logowania w wiadomościach e-mail. Zachowaj czujność.
        </span>
      </div>
      <div style="padding: 20px;">
        <h3 style="color: #1877f2; margin-top: 0; margin-bottom: 4px;">Nowa wiadomość prywatna</h3>
        <p style="font-size: 14px; color: #65676b; margin-top: 0;">
          Nadawca: <b>${senderDisplayName}</b> 
          <span style="color: #1877f2; font-weight: bold;">🟢 PROFIL ZWERYFIKOWANY</span>
        </p>
        <hr style="border:0; border-top:1px solid #e4e6eb; margin:16px 0;">
        <div style="font-size:15px; color:#050505; white-space: pre-wrap; background:#f0f2f5; padding:16px; border-radius:6px; border: 1px solid #dddfe2;">
          ${sanitizeHtml(messageText, { allowedTags: [], allowedAttributes: {} })}
        </div>
        <hr style="border:0; border-top:1px solid #e4e6eb; margin:16px 0;">
        <p style="font-size:13px; color:#65676b; line-height: 1.5;">
          👉 <b>Jak odpowiedzieć?</b> Kliknij przycisk "Odpowiedz" (Reply) w swoim programie pocztowym. Twoja odpowiedź trafi bezpośrednio na skrzynkę użytkownika <b>${senderDisplayName}</b>.
        </p>
        <p style="font-size:13px; margin-top: 12px;">
          🔗 <a href="${senderProfileUrl}" style="color:#1877f2; font-weight:bold; text-decoration:none;">Zobacz pełny profil nadawcy na platformie</a>
        </p>
      </div>
    </div>
  `;
html.getAdminAbuseAlertEmail = (
  authorName,
  originalTitle,
  reportContent,
  reportUrl,
) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f5c6cb; border-radius: 8px; max-width: 600px; background: #fffdfd;">
      <h2 style="color: #bc2525; margin-top: 0;">🚨 PILNE: Nowe zgłoszenie nadużycia w systemie</h2>
      <p>Administratorze,</p>
      <p>Użytkownik <b>${authorName}</b> przesłał zgłoszenie nadużycia wobec wpisu pt. <b>"${originalTitle}"</b>.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p><b>Uzasadnienie zgłoszenia:</b></p>
      <div style="background: #fff3f3; padding: 12px; border-radius: 6px; border-left: 4px solid #bc2525; color: #050505; font-style: italic;">
        ${reportContent}
      </div>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p>Zgłoszenie oczekuje na Twoją decyzję i weryfikację w panelu administracyjnym serwisu.</p>
      <p style="margin-top: 20px; text-align: center;">
        <a href="${reportUrl}" style="display: inline-block; background: #bc2525; color: white; padding: 10px 20px; border-radius: 6px; font-weight: bold; text-decoration: none;">Przejdź do Centrum Zgłoszeń Nadużyć</a>
      </p>
    </div>
  `;

html.getReporterResolutionEmail = (originalTitle, serviceName) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #d1e7dd; border-radius: 8px; max-width: 600px; background: #f8f9fa;">
      <h3 style="color: #146c43; margin-top: 0;">⚖️ Aktualizacja statusu Twojego zgłoszenia</h3>
      <p>Dzień dobry,</p>
      <p>Dziękujemy za dbanie o bezpieczeństwo społeczności. Informujemy, że Twoje zgłoszenie nadużycia dotyczące wpisu <b>"${originalTitle}"</b> zostało pomyślnie rozpatrzone przez zespół moderacji.</p>
      <p>Po zweryfikowaniu treści, moderator uznał zgłoszenie za zasadne. Wpis został trwale objęty ograniczeniem widoczności (status **Restricted**), a możliwość jego ponownego upublicznienia przez autora została zablokowana.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-size: 12px; color: #65676b;">Pozdrawiamy,<br>Zespół Moderacji ${serviceName}</p>
    </div>
  `;

html.getAuthorLockedNotificationEmail = (
  authorName,
  originalTitle,
  reportContent,
  serviceName,
) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f5c6cb; border-radius: 8px; max-width: 600px; background: #fffcfc;">
      <h3 style="color: #bc2525; margin-top: 0;">⚖️ Decyzja zespołu moderacji: Twój wpis został ograniczony</h3>
      <p>Witaj <b>${authorName}</b>,</p>
      <p>Informujemy, że zespół moderacji platformy <b>${serviceName}</b> zakończył weryfikację zgłoszenia nadużycia skierowanego przeciwko Twojemu publicznemu wpisowi: <b>"${originalTitle}"</b>.</p>
      
      <p>Po dokładnym przeanalizowaniu treści zgłoszenia oraz uzasadnienia, które brzmiało:</p>
      <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; border-left: 4px solid #65676b; color: #555; font-style: italic; margin-bottom: 16px;">
        ${reportContent}
      </div>

      <p><b>Moderator uznał zgłoszenie za w pełni zasadne. W związku z tym na Twój wpis nałożono kaskadowe restrykcje:</b></p>
      <ul style="line-height: 1.6; color: #050505;">
        <li>Widoczność posta została trwale zmieniona na stopień <b>👥 Dla obserwujących (Restricted)</b>.</li>
        <li>Post został zablokowany przed możliwością ponownego upublicznienia (🌐 Publiczny) przez autora.</li>
      </ul>

      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 20px 0;">
      <p style="font-size: 13px; color: #64748b; margin: 0;">Regulamin platformy zabrania publikacji treści noszących znamiona spamu, wulgaryzmów oraz mowy nienawiści. Dalsze naruszenia mogą skutkować permanentną blokadą Twojego konta.</p>
      <p style="font-size: 14px; margin-top: 12px;">Z poważaniem,<br><b>Zespół Bezpieczeństwa ${serviceName}</b></p>
    </div>
  `;

html.getAbuseReportRejectedEmail = (originalTitle, serviceName) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #e4e6eb; border-radius: 8px; max-width: 600px; background: #f8f9fa;">
      <h3 style="color: #65676b; margin-top: 0;">⚖️ Status Twojego zgłoszenia: Odrzucone</h3>
      <p>Dzień dobry,</p>
      <p>Informujemy, że Twoje zgłoszenie nadużycia dotyczące wpisu <b>"${originalTitle}"</b> zostało zweryfikowane przez zespół moderacji platformy <b>${serviceName}</b>.</p>
      <p>Po dokładnym przeanalizowaniu treści wpisu oraz przedstawionych zarzutów, moderator uznał zgłoszenie za <b>bezpodstawne</b>. W związku z tym zgłoszenie zostało odrzucone i zamknięte, a zakwestionowany wpis pozostaje publicznie dostępny.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-size: 12px; color: #65676b;">Pozdrawiamy,<br>Zespół Moderacji ${serviceName}</p>
    </div>
  `;

html.getAuthorClearedEmail = (authorName, originalTitle, serviceName) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #d1e7dd; border-radius: 8px; max-width: 600px; background: #fffdfd;">
      <h3 style="color: #146c43; margin-top: 0;">🌿 Dobra wiadomość: Zarzuty nadużycia zostały oddalone</h3>
      <p>Witaj <b>${authorName}</b>,</p>
      <p>Informujemy, że zespół moderacji platformy <b>${serviceName}</b> zakończył weryfikację zgłoszenia nadużycia, które wpłynęło wobec Twojego wpisu: <b>"${originalTitle}"</b>.</p>
      <p>Po zapoznaniu się ze sprawą, moderator podjął decyzję o <b>oddaleniu zarzutów</b>. Zgłoszenie zostało uznane za niezasadne i trwale usunięte z rejestru. Twój wpis nie podlega żadnym restrykcjom i jest w pełni bezpieczny.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-size: 14px; margin-top: 12px;">Z poważaniem,<br><b>Zespół Bezpieczeństwa ${serviceName}</b></p>
    </div>
  `;

html.getAuthorUnlockNotificationEmail = (
  authorName,
  originalTitle,
  serviceName,
) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #d1e7dd; border-radius: 8px; max-width: 600px; background: #f8fff9;">
      <h3 style="color: #146c43; margin-top: 0;">🔓 Blokada moderatorska została zdjęta!</h3>
      <p>Witaj <b>${authorName}</b>,</p>
      <p>Mamy przyjemność poinformować, że zespół moderacji platformy <b>${serviceName}</b> pozytywnie zweryfikował poprawki wprowadzone przez Ciebie we wpisie: <b>"${originalTitle}"</b>.</p>
      <p><b>Blokada moderatorska została oficjalnie zdjęta:</b></p>
      <ul style="line-height: 1.6; color: #050505;">
        <li>Flaga permanentnego ograniczenia widoczności (<i>isModeratorLocked</i>) została usunięta.</li>
        <li>Otrzymujesz z powrotem pełną możliwość samodzielnego zarządzenia widocznością posta – możesz go ponownie przestawić na stopień <b>🌐 Publiczny</b> w menu edycji.</li>
      </ul>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 20px 0;">
      <p style="font-size: 14px; margin-top: 12px;">Dziękujemy za współpracę i dostosowanie treści do standardów społeczności.<br>Z poważaniem,<br><b>Zespół Bezpieczeństwa ${serviceName}</b></p>
    </div>
  `;

/**
 * Powiadomienie o sukcesie weryfikacji ręcznej
 */
html.getVerificationSuccessEmail = (userName, serviceName) => `
    <div style="font-family: sans-serif; padding: 16px; border: 1px solid #d1e7dd; border-radius: 8px; max-width: 600px; background: #f8f9fa;">
      <h3 style="color: #146c43; margin-top: 0;">🟢 Gratulacje! Twój profil został zweryfikowany</h3>
      <p>Witaj <b>${userName}</b>,</p>
      <p>Informujemy, że zespół administracyjny platformy <b>${serviceName}</b> pomyślnie zaksięgował Twój przelew uwierzytelniający.</p>
      <p>Twój profil zyskał status <b>Wiarygodny profil</b>. Wszystkie ograniczenia publicystyczne, komentarze i zasięgi globalne zostały trwale odblokowane.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-size: 12px; color: #65676b;">Pozdrawiamy,<br>Zespół Administracji ${serviceName}</p>
    </div>
  `;

/**
 * Powiadomienie o odrzuceniu z powodu oszustwa / powtórzonego konta
 */
html.getVerificationRejectedEmail = (userName, adminComment, serviceName) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f5c6cb; border-radius: 8px; max-width: 600px; background: #fffcfc;">
      <h3 style="color: #bc2525; margin-top: 0;">❌ Weryfikacja tożsamości odrzucona</h3>
      <p>Dzień dobry <b>${userName}</b>,</p>
      <p>Informujemy, że weryfikacja Twojego profilu za pomocą przelewu bankowego zakończyła się wynikiem <b>negatywnym</b>.</p>
      <p><b>Powód odrzucenia:</b> Rachunek bankowy, z którego nadszedł przelew, został już użyty do uwierzytelnienia tożsamości innego profilu w systemie. Regulamin zabrania posiadania wielu kont przez tę samą osobę fizyczną.</p>
      
      ${
        adminComment && adminComment.trim().length > 0
          ? `
      <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; border-left: 4px solid #bc2525; color: #555; margin: 16px 0;">
        <b>Komentarz administratora:</b><br>${adminComment}
      </div>
      `
          : ""
      }

      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 20px 0;">
      <p style="font-size: 14px;">Z poważaniem,<br><b>Zespół Bezpieczeństwa ${serviceName}</b></p>
    </div>
  `;
/**
 * Szablon prośby o usunięcie konta (RODO Takedown Link)
 */
html.getAccountDeletionRequestEmail = (userName, deletionLink, serviceName) => `
    <div style="font-family: sans-serif; padding: 20px; border: 2px solid #bc2525; border-radius: 8px; max-width: 600px; background: #fffcfc;">
      <h2 style="color: #bc2525; margin-top: 0;">⚠️ Potwierdzenie usunięcia konta Użytkownika</h2>
      <p>Witaj <b>${userName}</b>,</p>
      <p>Zarejestrowaliśmy żądanie całkowitego i bezpowrotnego usunięcia Twojego profilu w serwisie <b>${serviceName}</b> na mocy praw RODO (Prawo do bycia zapomnianym).</p>
      <p style="color: #bc2525; font-weight: bold;">🚨 UWAGA: Ta operacja jest całkowicie nieodwracalna. Stracisz dostęp do wszystkich swoich artykułów, komentarzy i relacji.</p>
      <p>Jeśli świadomie podtrzymujesz tę decyzję, kliknij w poniższy link bezpieczeństwa, aby ostatecznie wymazać swoje dane:</p>
      <p style="margin: 20px 0; text-align: center;">
        <a href="${deletionLink}" style="display: inline-block; background: #bc2525; color: white; padding: 12px 24px; border-radius: 6px; font-weight: bold; text-decoration: none;">Potwierdzam - Usuń bezpowrotnie moje konto</a>
      </p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-size: 12px; color: #65676b; margin: 0;">Ten odnośnik jest ważny przez 24 godziny. Jeśli nie zlecałeś tej operacji, natychmiast zignoruj tę wiadomość i zmień hasło dostępowe do konta – Twoje dane są bezpieczne.</p>
    </div>
  `;

/**
 * Szablon oficjalnego powiadomienia o zakończeniu usuwania danych (RODO Certificate)
 */
html.getAccountDeletionSuccessNotification = (userName, serviceName) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #d1e7dd; border-radius: 8px; max-width: 600px; background: #f8fff9;">
      <h3 style="color: #146c43; margin-top: 0;">🌿 Potwierdzenie usunięcia danych osobowych (RODO)</h3>
      <p>Dzień dobry,</p>
      <p>Niniejszym informujemy, że procedura rozpatrywania Twojego wniosku o prawo do bycia zapomnianym została pomyślnie zakończona w systemie platformy <b>${serviceName}</b>.</p>
      <p>Wszystkie dane identyfikacyjne przypisane do osoby <b>${userName}</b>, w tym historia logowań, adresy IP, bufor wiadomości, tokeny bezpieczeństwa oraz kaskada opublikowanych artykułów i komentarzy zostały trwale i bezpowrotnie usunięte z produkcyjnej bazy danych.</p>
      <hr style="border:0; border-top:1px solid #e4e6eb; margin: 16px 0;">
      <p style="font-size: 12px; color: #65676b; margin: 0;">Wiadomość ma charakter formalnego powiadomienia i potwierdzenia realizacji praw podmiotu danych. Twój adres e-mail został użyty po raz ostatni wyłącznie w celu wysłania tego powiadomienia i nie jest dalej przetwarzany.</p>
    </div>
  `;
