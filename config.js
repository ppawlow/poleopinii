module.exports = {
  SERVICE_NAME: "Pole Opinii",
  SERVICE_LOGO: "/logo.jpeg",
  LOGOTYP: "/logotyp.jpeg",
  FAVICON: "/logo.jpeg",

  POST_VISIBILITY: ["public", "restricted", "private"],

  routeDir: "./routes",

  routers: {
    "/admin": "admin",
    "/auth": "auth",
    "/verify": "verify",
    "/posts": "posts",
    "/profile": "profile",
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
    { minLikes: 100, name: "🌟 Redaktor", color: "#9360f7", bg: "#f3ebff" },
    { minLikes: 50, name: "🔥 Wiodący Prym", color: "#bc2525", bg: "#fff3f3" },
    {
      minLikes: 20,
      name: "✍️ Doświadczony Publicysta",
      color: "#e5a93c",
      bg: "#fffbf0",
    },
    { minLikes: 5, name: "🌱 Aktywny Autor", color: "#42b72a", bg: "#f0fdf4" },
    { minLikes: 0, name: "🔰 Nowicjusz", color: "#65676b", bg: "#f0f2f5" },
  ],

  ADMINS: [],

  MAIN_ADMIN_EMAIL: `admin@poleopinii.pl`,

  DEFAULT_USER: {
    name: "Redakcja",
    email: process.env.DEFAULT_USER_EMAIL,
    avatarUrl: "/avatar.jpeg",
    coverUrl: "/cover.jpeg",
    alias: "redakcja",
    password: process.env.DEFAULT_USER_PASSWORD,
  },

  AI_CONFIG: {
    DEFAULT_PROVIDER: process.env.AI_PROVIDER || "gemini",

    // Częstotliwość odpytywania w formacie CRON
    // "0 4 * * *"     -> Codziennie o 04:00 rano (Zalecane produkcyjnie)
    // "*/15 * * * *"  -> Co każde 15 minut (Przydatne do testów deweloperskich)
    // "0 */2 * * *"   -> Co każde 2 godziny
    CRON_SCHEDULE: "0 4,10,16,22 * * *",

    // Maksymalna liczba tematów zapisywanych w prawym panelu
    MAX_TOPICS: 10,
  },

  // ZCENTRALIZOWANA MATRYCA UPRAWNIEŃ
  POST_PERMISSIONS: {
    public: {
      CREATE: (user) => user && user.isFullyVerified === true,
      LIKE: (user) => user && user.isFullyVerified === true,
      COMMENT: (user) => user && user.isFullyVerified === true,
    },
    restricted: {
      CREATE: (user) => (user ? true : false),
      LIKE: (user) => (user ? true : false),
      COMMENT: (user) => (user ? true : false),
    },
    private: {
      CREATE: (user) => (user ? true : false),
      LIKE: (user) => (user ? true : false),
      COMMENT: (user) => (user ? true : false),
    },
  },
  PROTECTED_USER_DATA: `email
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
  USER_PERMISSIONS: {
    canSendMail: (actingUser, targetUser) =>
      actingUser &&
      targetUser &&
      actingUser.isFullyVerified &&
      !actingUser.isBlocking(targetUser) &&
      !targetUser.isBlocking(actingUser),

    canReplyWithPost: (actingUser, targetUser) =>
      actingUser &&
      targetUser &&
      !actingUser.isBlocking(targetUser) &&
      !targetUser.isBlocking(actingUser) &&
      (actingUser.isFullyVerified || targetUser.isFollowing(actingUser)),
  },

  PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$/,

  BANK_TRANSFER_DATA: {
    name: "PoleOpinii.pl",
    bank: "Nest Bank",
    number: "78 2530 0008 2097 1091 9637 0001",
  },

  PORT: 3000,
  SALT_ROUNDS: 12,
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY,
  RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_SITE_KEY,
  useRecaptcha: false,
  isDevelopment: process.env.NODE_ENV === "development",
};
