require("dotenv").config();

if (!process.env.SESSION_SECRET) {
  console.error(
    "BŁĄD KRYTYCZNY: Brak zdefiniowanej zmiennej SESSION_SECRET w pliku .env!",
  );
  process.exit(1); // Zatrzymujemy aplikację przed uruchomieniem w stanie podatnym na ataki
}
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const helmet = require("helmet");
const { globalLimiter, adminScannerLimiter } = require("./tools/validation");
const { startNotification } = require("./tools/mailer");

const sanitize = require("express-mongo-sanitize").sanitize;
const path = require("path");
const MongoStore = require("connect-mongo").default;
const {
  hasPermission,
  isAdminId,
  getSubtreeFromRouter,
  userData,
  // initializeReservedAliases,
  isLoggedIn,
} = require("./tools/security");

//Konfiguracja serwera
const {
  SERVICE_NAME,
  SERVICE_LOGO,
  RESERVED_ALIASES,
  DEFAULT_ASSETS,
  PORT,
  FAVICON,
  LOGOTYP,
  isDevelopment,
  DEFAULT_USER,
  RECAPTCHA_SITE_KEY,
  useRecaptcha,
} = require("./config");

//Narzędzia
const {
  User,
  Alias,
  createLog,
  //getScopedPosts,
  createVerifiedUser,
} = require("./tools/db");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fontawesome.com",
          "https://*.fontawesome.com",
          "https://datatables.net",
          "https://*.datatables.net",
          "https://*.googleapis.com",
        ],
        
        "script-src-elem": [
          "'self'",
          "'unsafe-inline'",
          "https://fontawesome.com",
          "https://*.fontawesome.com",
          "https://google.com",
          "https://*.google.com",
          "https://googleapis.com",
          "https://*.googleapis.com",
          "https://gstatic.com",
          "https://*.gstatic.com",
          "https://datatables.net",
          "https://*.datatables.net",
        ],
        
        "script-src-attr": ["'unsafe-inline'"],
        
        "connect-src": [
          "'self'",
          "http://localhost:*",
          "http://127.0.0.1:*",
          "ws://localhost:*",
          "ws://127.0.0.1:*",
          "https://fontawesome.com",
          "https://*.fontawesome.com",
        ],
        
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fontawesome.com",
          "https://*.fontawesome.com",
          "https://googleapis.com",
          "https://google.com",
          "https://*.googleapis.com",
          "https://cloudflare.com",
          "https://*.cloudflare.com",
          "https://datatables.net",
          "https://*.datatables.net",
        ],
        
        "font-src": [
          "'self'",
          "data:",
          "https://fontawesome.com",
          "https://*.fontawesome.com",
          "https://gstatic.com",
          "https://*.gstatic.com"
        ],

        "img-src": [
          "'self'", 
          "data:", 
          "https:", 
          "https://*.gstatic.com", 
          "https://www.google.com"
        ],
        
        "frame-src": [
          "'self'",
          "https://google.com",
          "https://*.google.com",
          "https://*.gstatic.com"
        ]
      }
    },
    crossOriginOpenerPolicy: isDevelopment ? false : { policy: "same-origin" },
    crossOriginResourcePolicy: isDevelopment ? false : { policy: "same-origin" },
    hsts: false
  })
);

app.set("trust proxy", 1);
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

/*******************
 * MIDDLEWARES
 ******************/

// Limitery
app.use(globalLimiter);
app.use("/admin", adminScannerLimiter);

// ==========================================
// 1. OCHRONA PRZED NOSQL INJECTION (SANITYZACJA)
// ==========================================
app.use((req, res, next) => {
  //Bezpiecznie oczyszczamy ciało żądania (req.body) oraz parametry ścieżki (req.params)
  if (req.body) sanitize(req.body, { allowDots: true });
  if (req.params) sanitize(req.params, { allowDots: true });
  next();
});

// ==========================================
// 2. MIDDLEWARE PODSTAWOWE ORAZ PARSERY
// ==========================================
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

// ==========================================
// 3. KONFIGURACJA SESJI
// ==========================================
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/test",
      ttl: 14 * 24 * 60 * 60,
    }),
    cookie: {
      httpOnly: true,
      secure: isDevelopment ? false : true,
      sameSite: "lax",
      path: "/",
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  }),
);

// ==========================================
// 4. OCHRONA ORAZ OBSŁUGA CSRF
// ==========================================
app.use(csurf({ cookie: true }));

// Globalne przekazywanie sesji ORAZ tokenu CSRF do widoków Pug
app.use(async (req, res, next) => {
  res.locals = {
    csrfToken: req.csrfToken(),
    windowOrigin: req.protocol + "://" + req.get("host"), // <--- DODAJ TĘ LINIJKĘ
    DEFAULT_ASSETS,
    SERVICE_NAME,
    SERVICE_LOGO,
    FAVICON,
    LOGOTYP,
    hasPermission,
    RECAPTCHA_SITE_KEY,
    isDevelopment,
    useRecaptcha,
  };
  console.log(res.locals);
  res.locals.getProfileUrl = function (userDetails) {
    if (!userDetails) return "/";

    // Jeśli przekazano bezpośrednio string (ID) lub obiekt Mongoose
    if (typeof userDetails === "string") return `/profile/${userDetails}`;

    const userAlias = userDetails.alias || userDetails.authorDetails?.alias;
    const userId = userDetails._id || userDetails.id || userDetails.authorId;

    if (userAlias) return `/profile/${userAlias}`;
    if (userId) return `/profile/${userId.toString()}`;

    return "/";
  };

  next();
});

app.use(userData);

// ==========================================
// 5. Centralna obsługa błędu CSRF
// ==========================================
app.use((err, req, res, next) => {
  if (err.code !== "EBADCSRFTOKEN") return next(err);
  res
    .status(403)
    .send(
      "Błąd bezpieczeństwa: Niepoprawny lub brakujący token CSRF. Odśwież stronę.",
    );
});

// =========================================================================
// 6. MECHANIZM ŚLEDZENIA ROUTERÓW DLA EXPRESS 5
// =========================================================================
//Mapa serwera: dla każdej metody oddzielnie pobierzemy endpointy
const serviceMap = { GET: {}, POST: {} };

// ==========================================
// 7. PODPIĘCIE ROUTERÓW (config.js)
// ==========================================
function setupEndpoints(app) {
  const { routeDir, routers } = require("./config");
  for (const k in routers) {
    const src = routers[k] || k;
    let routerInstance;
    if (/.*\.mjs/.test(src)) {
      routerInstance = require(`${routeDir}/${src}`).default;
    } else {
      routerInstance = require(`${routeDir}/${src}`);
    }
    app.use(k, routerInstance);
    for (const m in serviceMap) {
      serviceMap[m][k.slice(1)] = getSubtreeFromRouter(routerInstance, m);
    }
  }
}

setupEndpoints(app);
console.log(RESERVED_ALIASES);

// ==========================================
// 8. OBSŁUGA BŁĘDÓW MULTERA
// ==========================================
const multer = require("multer");
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .send(
          "Błąd przesyłania: Plik jest zbyt duży. Maksymalny rozmiar to 5MB.",
        );
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res
        .status(400)
        .send(
          "Błąd walidacji: Niedozwolony format pliku. Akceptowane są wyłącznie zdjęcia (JPG, PNG, GIF, WEBP).",
        );
    }
    return res.status(400).send(`Błąd przetwarzania pliku: ${err.message}`);
  }
  next(err);
});

// ==========================================
// 9. URUCHOMIENIE APLIKACJI
// ==========================================
app.listen(PORT || process.env.PORT, async () => {
  if (DEFAULT_USER) {
    const defaultUser = await createVerifiedUser(DEFAULT_USER);
    console.log("Default user:", defaultUser);
  }
  console.log(`Aplikacja działa na porcie ${PORT || process.env.PORT}`);
  startNotification();
  const { initializeNewsCron } = require("./tools/aiNewsService");
  initializeNewsCron();
});
