const TARGET_TEST_EMAIL = "piotr.roman.pawlowski@gmail.com"; 

require("dotenv").config();
const mongoose = require("mongoose");
const mailer = require("./tools/mailer");
const config = require("./config");

// Podmiana konfiguracji globalnej na adres testowy użytkownika
config.MAIN_ADMIN_EMAIL = TARGET_TEST_EMAIL;
process.env.MAIN_ADMIN_EMAIL = TARGET_TEST_EMAIL;

// Przygotowanie mocków i atrap struktur danych zgodnych z Mongoose / MongoDB
const mockUser = {
  _id: new mongoose.Types.ObjectId("6adeff567d07c910c127ed5a"),
  id: "6adeff567d07c910c127ed5a",
  name: "Jan testowy-Kowalski",
  displayName: "Jan testowy-Kowalski",
  email: TARGET_TEST_EMAIL,
  newEmailPending: TARGET_TEST_EMAIL + ".pending",
  avatarUrl: "/uploads/avatar-mock.png",
  securityToken: "abcdef1234567890testtoken",
  token: "abcdef1234567890testtoken",
  verificationTransferCode: "VERIFY-TEST-1234"
};

const mockRecipient = {
  _id: new mongoose.Types.ObjectId("6adeff567d07c910c127ed5b"),
  name: "Odbiorca Wiadomości",
  displayName: "Odbiorca Wiadomości",
  email: TARGET_TEST_EMAIL
};

const mockPost = {
  _id: new mongoose.Types.ObjectId("6adeff567d07c910c127ed5c"),
  title: "Fikcyjny Artykuł Testowy",
  author: "Jan testowy-Kowalski",
  authorEmail: TARGET_TEST_EMAIL,
  authorId: mockUser._id,
  visibility: "public",
  content: "<p>To jest fikcyjna treść artykułu publicznego przygotowana do testowania systemów pocztowych SMTP.</p>",
  abuseCategory: "general"
};

const mockCopyrightPost = {
  ...mockPost,
  _id: new mongoose.Types.ObjectId("6adeff567d07c910c127ed5d"),
  title: "Artykuł Naruszający Prawa Autorskie",
  abuseCategory: "copyright"
};

const mockReport = {
  _id: new mongoose.Types.ObjectId("6adeff567d07c910c127ed5e"),
  title: "⚠️ ZGŁOSZENIE NADUŻYCIA: \"Fikcyjny Artykuł Testowy\"",
  author: "Anonimowy Użytkownik",
  authorEmail: TARGET_TEST_EMAIL,
  content: "Użytkownik zgłosił ten post, ponieważ zawiera on nieodpowiednie słownictwo oraz mowa nienawiści.",
  abuseCategory: "general"
};

const mockReq = {
  protocol: "http",
  get: () => "localhost:3000"
};

async function runMailerTestPipeline() {
  console.log("=================================================================");
  console.log(` Inicjalizacja testu wysyłki e-mail dla adresu: ${TARGET_TEST_EMAIL}`);
  console.log("=================================================================\n");

  const tasks = [
    {
      name: "startNotification (Uruchomienie serwera)",
      fn: () => mailer.startNotification()
    },
    {
      name: "sendVerificationEmail (Link aktywacyjny - Rejestracja)",
      fn: () => {
        const registrationMock = { ...mockUser, newEmailPending: null };
        return mailer.sendVerificationEmail(registrationMock, mockReq);
      }
    },
    {
      name: "sendVerificationEmail (Potwierdzenie zmiany adresu e-mail RODO)",
      fn: () => mailer.sendVerificationEmail(mockUser, mockReq)
    },
    {
      name: "sendPasswordResetEmail (Link resetowania hasła)",
      fn: () => mailer.sendPasswordResetEmail(mockUser, mockReq)
    },
    {
      name: "sendReplyNotificationEmail (Nowa polemika / odpowiedź postem)",
      fn: () => mailer.sendReplyNotificationEmail(mockUser, mockReq, mockPost, mockPost)
    },
    {
      name: "sendAbuseReportEmail (Zgłoszenie nadużycia - Procedura standardowa)",
      fn: () => mailer.sendAbuseReportEmail(mockPost, mockReport, mockReq)
    },
    {
      name: "sendAbuseReportEmail (Zgłoszenie naruszenia praw autorskich - Copyright Alert)",
      fn: () => mailer.sendAbuseReportEmail(mockCopyrightPost, mockReport, mockReq)
    },
    {
      name: "sendPrivatePeerEmail (Komunikacja prywatna Peer-to-Peer)",
      fn: () => mailer.sendPrivatePeerEmail(mockUser, mockRecipient, "Pytanie o współpracę publicystyczną", "Cześć! Bardzo podoba mi się Twój styl pisania. Czy chciałbyś opracować wspólnie temat makroekonomiczny?", mockReq)
    },
    {
      name: "sendAbuseReportAcceptedEmails (Uznanie zgłoszenia przez Moderatora)",
      fn: () => mailer.sendAbuseReportAcceptedEmails(mockPost, mockReport)
    },
    {
      name: "sendAbuseReportRejectedEmails (Odrzucenie zgłoszenia / Oddalenie zarzutów)",
      fn: () => mailer.sendAbuseReportRejectedEmails(mockPost, mockReport)
    },
    {
      name: "sendPostUnlockedNotificationEmail (Zdjęcie blokady moderatorskiej z wpisu)",
      fn: () => mailer.sendPostUnlockedNotificationEmail(mockPost)
    },
    {
      name: "sendVerificationSuccessEmail (Sukces weryfikacji konta bankowego)",
      fn: () => mailer.sendVerificationSuccessEmail(mockUser)
    },
    {
      name: "sendVerificationRejectedEmail (Odrzucenie przelewu weryfikacyjnego)",
      fn: () => mailer.sendVerificationRejectedEmail(mockUser, "Przelew przyszedł z rachunku innej osoby niż podana w rejestracji profilu.")
    },
    {
      name: "sendAccountDeletionRequestEmail (RODO Krok 1 - Wniosek o skasowanie)",
      fn: () => mailer.sendAccountDeletionRequestEmail(mockUser, mockReq)
    },
    {
      name: "sendAccountDeletionSuccessNotification (RODO Krok 2 - Potwierdzenie wymazania)",
      fn: () => mailer.sendAccountDeletionSuccessNotification(mockUser.name, TARGET_TEST_EMAIL)
    },
    {
      name: "sendEditorCandidateEmail (Osiągnięcie limitu 100 gwiazdek - Status Kandydata)",
      fn: () => mailer.sendEditorCandidateEmail(mockUser, 100)
    },
    {
      name: "sendEditorApprovedByBoardEmail (Mianowanie Redaktorem przez Kolegium)",
      fn: () => mailer.sendEditorApprovedByBoardEmail(mockUser)
    }
  ];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    process.stdout.write(`[${i + 1}/${tasks.length}] Wysyłanie: ${task.name}... `);
    try {
      await task.fn();
      console.log("🟢 WYPCHNIĘTO");
    } catch (err) {
      console.log(`🔴 BŁĄD: ${err.message}`);
    }
  }

  console.log("\n=================================================================");
  console.log(" 🎉 Wszystkie procedury testowe mailera zostały zakończone.");
  console.log(" Sprawdź swoją pocztę lub logi lokalnego serwera SMTP (np. Mailpit).");
  console.log("=================================================================");
  process.exit(0);
}

// Uruchomienie potoku testowego
runMailerTestPipeline();
