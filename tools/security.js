const { User, createLog } = require("./db");
const {
  POST_PERMISSIONS,
  USER_PERMISSIONS,
  ADMINS,
  PROTECTED_USER_DATA,
} = require("../config");

const toolbox = {};

module.exports = toolbox;

//Tablica przechowująca zastrzeżone pola w obiekcie User
const protect = PROTECTED_USER_DATA.trim().split(/\s+/);

// Kopiuje obiekt User, usuwając zastrzeżone pola
const safeUser = function (user) {
  const ret = new user.constructor(user);
  protect.forEach((v) => (ret[v] = undefined));
  return ret;
};
// Zwraca dane użytkownika id
const userData = async (id) => User.findById(id);

// Sprawdza, czy użytkownik jest adminem
toolbox.isAdminId = (userId) =>
  userId ? ADMINS.includes(userId.toString()) : false;

// Zwraca id użytkownika z obiektu session
const LoggedUserId = (req) => req.session?.user?.id;

// Sprawdza, czy użytkownik jest zalogowany
const isLoggedIn = (req) => !!LoggedUserId(req);

// Zwraca bezpieczną wersję profilu użytkownika
toolbox.getProfile = async function (id) {
  const user = await userData(id);
  return user ? safeUser(user) : undefined;
};

// Funkcja dodająca zastrzeżone pola (extras), jeśli są konieczne
toolbox.appendUserData = async function (user, extras) {
  const dbUser = await User.findById(user._id).select(extras);
  user.set(dbUser);
};

// Middleware blokujący dostęp dla niezalogowanych
toolbox.isUser = function (req, res, next) {
  if (isLoggedIn(req)) return next();
  return res.redirect("/auth/login");
};

// Middleware blokujący dostep dla zalogowanych
toolbox.isGuest = function (req, res, next) {
  if (!isLoggedIn(req)) return next();
  return res.redirect("/");
};

// Middleware wstrzykujący dane zalogowanego użytkownika
// Do obiektu req wstrzykujemy kompletne dane, a do obiektu
// res.locals wstrzykujemy jedynie bezpieczne dane do wykorzystania
// w szablonach widoków.
toolbox.userData = async function (req, res, next) {
  req.dbUser = await userData(LoggedUserId(req));
  if (req.dbUser) {
    res.locals.user = safeUser(req.dbUser);
    res.locals.user.isAdmin = toolbox.isAdminId(req.dbUser.id);
  }
  next();
};

/**
 * Middleware blokujący niezalogowanych użytkowników
 * Wcześniej (na samym poczatku tras) musi być włączony
 * toolbox.userData
 */
toolbox.accessControl = async function (req, res, next) {
  if (!req.dbUser) {
    if (
      req.xhr ||
      (req.headers.accept && req.headers.accept.indexOf("json") > -1)
    ) {
      return res.status(401).send("Zaloguj się");
    }
    return res.redirect("/auth/login");
  }
  next();
};

/**
 * Middleware blokujący nie-adminów i raportujacy wydarzenie
 * dostepu jako admin
 */

toolbox.adminControl = async function (req, res, next) {
  const userId = LoggedUserId(req);
  const targetPath = req.originalUrl || req.url;

  if (toolbox.isAdminId(userId)) {
    try {
      await createLog(
        req,
        `[ADMIN - DOSTĘP PRZYZNANY] Poprawna autoryzacja do zasobu:
            (id:${userId}) ${targetPath}`,
      );
    } catch (logErr) {
      console.error("Błąd zapisu logu autoryzowanego dostępu:", logErr);
    }
    return next();
  }

  try {
    await createLog(
      req,
      `[ODRZUCONO - BRAK UPRAWNIEŃ] Nieautoryzowana próba wejścia na zasób administracyjny:  (id:${userId}) ${targetPath}`,
    );
  } catch (logErr) {
    console.error("Błąd zapisu logu nieautoryzowanego dostępu:", logErr);
  }

  return res
    .status(403)
    .send(
      "Brak uprawnień: Ta sekcja jest dostępna wyłącznie dla administratorów systemu.",
    );
};

/**
 * Uniwersalny weryfikator uprawnień na podstawie matryc z pliku konfiguracyjnego.
 */
toolbox.hasPermission = function (
  actingUser,
  scope,
  action,
  targetUser = null,
) {
  if (!actingUser) return false;

  // 1. Obsługa uprawnień relacyjnych między użytkownikami
  if (scope === "user") {
    const userRule = USER_PERMISSIONS[action];
    return typeof userRule === "function"
      ? userRule(actingUser, targetUser)
      : false;
  }

  // 2. Obsługa poziomów widoczności postów
  const scopeRules = POST_PERMISSIONS[scope];
  return typeof scopeRules?.[action] === "function"
    ? scopeRules[action](actingUser)
    : false;
};

/*
 * Funkcja odrzucająca zapytanie od nieuprawnionych
 */
toolbox.sendAccessDenied = function (req, res, customMessage = null) {
  const fallbackMsg =
    'Ta akcja wymaga dodatkowej weryfikacji konta. <a href="/verify" style="color: #1877f2; font-weight: bold; text-decoration: underline;">Dowiedz się więcej</a>';
  const message = customMessage || fallbackMsg;

  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.indexOf("json") > -1)
  ) {
    return res.status(403).json({ error: message });
  }
  return res.status(403).send(message);
};

/*
 * Funkcja uzywana do konstruowania mapy serwisu, aby wrzucić
 * istniejace trasy do zbioru zakazanych aliasów
 */
toolbox.getSubtreeFromRouter = function (router, method) {
  const segmentsList = [];
  const targetMethod = method.toLowerCase();
  const seenPaths = new Set();

  const stack = router?.stack || router?.router?.stack;
  if (!stack || !Array.isArray(stack)) return [];

  stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      if (layer.route.methods && layer.route.methods[targetMethod]) {
        const paths = [].concat(layer.route.path);

        paths.forEach((p) => {
          const cleanRoute = p.replace(/^\/+|\/+\$|\?\$/g, "");
          if (cleanRoute === "" || seenPaths.has(cleanRoute)) return;
          seenPaths.add(cleanRoute);
          segmentsList.push(cleanRoute.split("/"));
        });
      }
    }
  });

  return segmentsList;
};
