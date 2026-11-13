module.exports = {
  SERVICE_NAME: "Pole Opinii",
  SERVICE_LOGO: "/logo.jpeg",
  LOGOTYP: "/logotyp.jpeg",
  FAVICON: "/logo.jpeg",

  POST_VISIBILITY: ["public", "restricted", "private", "editors"],

  routeDir: "./routes",

  routers: {
    "/admin": "admin",
    "/auth": "auth",
    "/verify": "verify",
    "/posts": "posts",
    "/profile": "profile",
    "/editors": "editors",
    "/": "main", //Zawsze na końcu!
  },

  RESERVED_ALIASES: [
    "administrator",
    "admin",
    "superuser",
    "ogloszenia",
    "gospodarka",
    "polityka",
    "kultura",
    "sport",
    "styl",
  ],

  DEFAULT_ASSETS: {
    uploads: "../public/uploads",
    avatar: "/default-avatar.png",
    cover: "/default-cover.png",
  },

  AUTHOR_RANKS: [
    { minLikes: 100, name: "⏳ Kandydat na redaktora", color: "#a855f7", bg: "#f3e8ff" },
    { minLikes: 50, name: "🔥 Wiodący Prym", color: "#bc2525", bg: "#fff3f3" },
    { minLikes: 20, name: "✍️ Doświadczony Publicysta", color: "#e5a93c", bg: "#fffbf0" },
    { minLikes: 5, name: "🌱 Aktywny Autor", color: "#42b72a", bg: "#f0fdf4" },
    { minLikes: 0, name: "🔰 Nowicjusz", color: "#65676b", bg: "#f0f2f5" },
  ],
  ADMINS: ["6adeff567d07c910c127ed5d"],

  MAIN_ADMIN_EMAIL: `admin@poleopinii.pl`,

  SYSTEM_USERS: [
    {
      name: "Redakcja",
      email: process.env.DEFAULT_USER_EMAIL,
      avatarUrl: "/avatar.jpeg",
      coverUrl: "/cover.jpeg",
      alias: "redakcja",
      password: process.env.DEFAULT_USER_PASSWORD,
      role: "editor",
      allowPrivateEmails: true,
    },
    {
      name: "AIsystent",
      email: "aisystent@poleopinii.pl",
      avatarUrl: "/aiAvatar.jpeg",
      coverUrl: "/aiCover.svg",
      alias: "aisystent",
      password: require("crypto").randomBytes(32).toString("hex"),
      role: "user",
      allowPrivateEmails: false,
      bio:`Jestem autonomicznym profilem systemowym platformy PoleOpinii.pl realizującym zadania analityczne oraz audyt faktograficzny treści w czasie rzeczywistym, w oparciu o integrację techniczną z zewnętrznym interfejsem programistycznym (API) modeli językowych Gemini oraz silnika Google Search Grounding. Publikowane tutaj raporty mają charakter doradczy i pomocniczy. Jest to niezależne narzędzie publicystyczne platformy PoleOpinii.pl i nie jest ono w żaden sposób oficjalnie powiązane, sponsorowane, autoryzowane ani prowadzone przez firmę Google LLC ani jej podmioty zależne. Gemini oraz Google są zastrzeżonymi znakami towarowymi należącymi do Google LLC.`,
    }
  ],
  AI_CONFIG: {
    DEFAULT_PROVIDER: process.env.AI_PROVIDER || "gemini",

    // Częstotliwość odpytywania w formacie CRON
    // Przykłady:
    // "0 4 * * *"     -> Codziennie o 04:00 rano 
    // "0 */4 * * *"   -> Co 4 godziny (od 0:00)
    CRON_SCHEDULE: "0 4,10,16,22 * * *",

    // Maksymalna liczba tematów zapisywanych w prawym panelu
    MAX_TOPICS: 10,
  },

  // MATRYCA UPRAWNIEŃ W ZAKRESIE PUBLIKACJI
  POST_PERMISSIONS: {
    public: {
      CREATE:   (user) => user?.isPublicAllowed,
      LIKE:     (user) => user?.isPublicAllowed,
      COMMENT:  (user) => user?.isPublicAllowed,
      BYPASS_AI:(user) => user?.isEditor,
    },
    restricted: {
      CREATE:   (user) => user ? true : false,
      LIKE:     (user) => user ? true : false,
      COMMENT:  (user) => user ? true : false,
    },
    private: {
      CREATE:   (user) => user ? true : false,
      LIKE:     (user) => user ? true : false,
      COMMENT:  (user) => user ? true : false,
    },
    editors: {
      CREATE:   (user) => user?.isEditor,
      LIKE:     (user) => user?.isEditor,
      COMMENT:  (user) => user?.isEditor,
    },
  },
  
  PROTECTED_USER_DATA: `
     email
     normalizedEmail
     password
     newEmailPending
     securityToken
     securityTokenExpires
     passwordResetToken
     passwordResetExpires
     verificationBankAccount
     verificationTransferCode
     aiBlockedSafetyCount
     aiBlockedFactCheckCount
    `,

  // ===================================
  // MATRYCA UPRAWNIEŃ W RELACJACH
  // ===================================
  USER_PERMISSIONS: { // <--- TUTAJ BYŁO BŁĘDNIE "POST_PERMISSIONS"
    canSendMail: (actingUser, targetUser) =>
      actingUser && targetUser &&
      actingUser.isPublicAllowed &&
      !actingUser.isBlocking(targetUser) &&
      !targetUser.isBlocking(actingUser),

    canReplyWithPost: (actingUser, targetUser) =>
      actingUser && targetUser &&
      !actingUser.isBlocking(targetUser) &&
      !targetUser.isBlocking(actingUser) &&
      (actingUser.isPublicAllowed || targetUser.isFollowing(actingUser)),
  },

  PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$/,

  BANK_TRANSFER_DATA: {
    name: "PoleOpinii.pl",
    bank: "Nest Bank",
    number: "78 2530 0008 2097 1091 9637 0001",
  },
  
    SHARE_PLATFORMS: [
    {
      id: "facebook",
      label: "Udostępnij na Facebooku",
      icon: "fa-brands fa-facebook",
      bgColor: "#1877f2",
      urlTemplate: "https://facebook.com/sharer/sharer.php?u={url}",
    },
    {
      id: "x",
      label: "Udostępnij na platformie X",
      icon: "fa-brands fa-x-twitter",
      bgColor: "#000000",
      urlTemplate: "https://twitter.com/intent/tweet?url={url}&text={title}",
    },
    {
      id: "linkedin",
      label: "Udostępnij na LinkedIn",
      icon: "fa-brands fa-linkedin",
      bgColor: "#0077b5",
      urlTemplate: "https://linkedin.com/sharing/share-offsite/?url={url}",
    },
  ],
  

  PORT: 3000,
  SALT_ROUNDS: 12,
  useRecaptcha: process.env.USE_RECAPTCHA || false,
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY,
  RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_PUBLIC_KEY,
  isDevelopment: process.env.NODE_ENV === "development",
};
