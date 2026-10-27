const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const { ObjectId } = require("mongodb");
const sanitizeHtml = require("sanitize-html");
const { POST_VISIBILITY, PASSWORD_REGEX } = require("../config");
// const { isAliasReserved } = require("./security");
const { verifyBufferSignature } = require("./db");

const tools = { validationResult };
module.exports = tools;

// Funkcja walidacji zawartości edytora HTML
// tools/validation.js

tools.validateContent = function (content) {
  if (!content || typeof content !== "string") return "";

  // 1. KROK: Najpierw przepuszczamy przez sanitizer (zabezpieczenie XSS)
  let sanitized = sanitizeHtml(content, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "ol",
      "ul",
      "li",
      "h1",
      "h2",
      "h3",
      "span",
      "blockquote",
      "pre",
      "sub",
      "sup",
      "a",
      "img",
      "iframe",
    ],
    allowedAttributes: {
      span: ["style", "class"],
      p: ["class"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "title", "class"],
      iframe: [
        "src",
        "frameborder",
        "allowfullscreen",
        "width",
        "height",
        "class",
        "scrolling",
      ],
    },
    allowedClasses: {
      iframe: ["ql-video"],
      span: ["ql-cursor", "ql-font-*", "ql-size-*"],
      p: [
        "ql-align-left",
        "ql-align-center",
        "ql-align-right",
        "ql-align-justify",
      ],
      img: ["ql-image-inline"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"], iframe: ["https"] },
    allowedIframeHostnames: ["youtube.com", "youtu.be", "vimeo.com"],
    allowedStyles: {
      span: {
        color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/, /^rgb\(\d+,\s*\d+,\s*\d+\)$/],
        "background-color": [
          /^#(?:[0-9a-fA-F]{3}){1,2}$/,
          /^rgb\(\d+,\s*\d+,\s*\d+\)$/,
        ],
      },
      p: { "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/] },
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
  });

  // 2. KROK (BEZPIECZNY REPLACER):
  // Czyścimy twarde spacje tekstowe (zarówno encje, jak i surowy znak Unicode),
  // ale przy użyciu negatywnego dopasowania (Negative Lookahead), aby NIE usuwać ich,
  // jeśli stoją same w pustym akapicie typu <p>&nbsp;</p> lub <p>\u00a0</p>
  sanitized = sanitized.replace(/(?<!<p>)(&nbsp;|\u00a0)(?!\s*<\/p>)/g, " ");

  return sanitized;
};
// tools/validation.js

// ZMIANA: Dodano opcjonalny parametr res na końcu sygnatury
tools.validatePublicContent = async function (req, title, content, res = null) {
  try {
    const { GoogleGenAI } = require("@google/genai");
    const { createLog } = require("./systemLog");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: "v1beta",
    });

    const dbUser = req.dbUser;
    const executionEmail = dbUser ? dbUser.email : "Anonimowy Twórca";
    const fullTextToAnalyze = `Tytuł wpisu: ${title}\nTreść wpisu: ${content.replace(/<\/?[^>]+(>|$)/g, "")}`;
    const totalTokens = { input: 0, output: 0, total: 0 };

    // =========================================================================
    // ETAP 1: AUDYT BEZPIECZEŃSTWA (Safety, Hate Speech, Policy)
    // =========================================================================
    const safetyInstruction = `Jesteś rygorystycznym algorytmem moderującym treść na poważnej platformie publicystycznej. 
    Przeanalizuj przesłany tekst pod kątem: wulgaryzmów (w tym ukrytych), mowy nienawiści, dyskryminacji (rasowej, religijnej, płciowej), wzywania do przemocy, nawoływania do łamania prawa oraz treści pornograficznych/erotycznych.
    Zwróć dane wyłącznie jako ustrukturyzowany obiekt JSON zawierający pola:
    - 'approved' (wartość Boolean: true jeśli tekst jest bezpieczny, false jeśli wykryto naruszenie).
    - 'reason' (krótki, konkretny tekst po polsku wyjaśniający powód odrzucenia, lub null jeśli approved wynosi true).`;

    const safetyResponse = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: fullTextToAnalyze,
      config: {
        systemInstruction: safetyInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            approved: { type: "BOOLEAN" },
            reason: { type: "STRING" },
          },
          required: ["approved", "reason"],
        },
      },
    });

    const safetyResult = JSON.parse(safetyResponse.text);

    const safetyMeta = safetyResponse.usageMetadata || {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    };
    totalTokens.input += safetyMeta.promptTokenCount;
    totalTokens.output += safetyMeta.candidatesTokenCount;
    totalTokens.total += safetyMeta.totalTokenCount;

    if (!safetyResult.approved) {
      const logMessage = `[AI MODERACJA - BLOKADA] Odrzucono post publiczny ze względów bezpieczeństwa ("${title}"). Powód: ${safetyResult.reason}. Zużycie API: In: ${totalTokens.input} | Out: ${totalTokens.output} | Total: ${totalTokens.total} tokenów.`;
      await createLog(req, logMessage, executionEmail);

      if (dbUser && typeof dbUser.updateOne === "function") {
        await dbUser.updateOne({ $inc: { aiBlockedSafetyCount: 1 } });
      }

      return {
        approved: false,
        reason:
          safetyResult.reason ||
          "Treść została odrzucona przez filtry bezpieczeństwa systemu.",
        factCheckReport:
          "Weryfikacja faktograficzna została wstrzymana z powodu wykrycia naruszeń polityki bezpieczeństwa.",
      };
    }

    // =========================================================================
    // NOWOŚĆ: WYDRUK STRUMIENIOWY (SSE) DLA PRZEGLĄDARKI PO 1. ETAPIE
    // =========================================================================
    if (res && typeof res.write === "function") {
      res.write(
        `data: ${JSON.stringify({ status: "stage1_success", message: "Wstępna ocena bezpieczeństwa przeszła pozytywnie. Trwa weryfikacja faktograficzna..." })}\n\n`,
      );
    }
    // =========================================================================

    // =========================================================================
    // ETAP 2: AUTODETEKCJA BŁĘDÓW FAKTOGRAFICZNYCH (Fact-Checking)
    // =========================================================================
    const factCheckInstruction = `Jesteś niezależnym, obiektywnympexpertem weryfikującym fakty (Fact-checker). 
    Przeanalizuj przesłany artykuł prasowy pod względem faktograficznym. Wykryj wszelkie kłamstwa, rażące manipulacje, nieprawdziwe daty, błędne nazwiska lub zmyślone wydarzenia historyczne/polityczne.
    Zwróć dane wyłącznie jako ustrukturyzowany obiekt JSON zawierający pola:
    - 'hasErrors' (wartość Boolean: true jeśli wykryto błędy faktograficzne lub fake news, false jeśli informacje są prawdziwe).
    - 'report' (szczegółowy, punktowy raport w języku polskim. Jeśli hasErrors wynosi true, wypisz konkretne błędy i podaj prawdę. Jeśli hasErrors wynosi false, napisz krótko: 'Weryfikacja pomyślna. Nie wykryto błędów faktograficznych.').`;

    const factCheckResponse = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: fullTextToAnalyze,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: factCheckInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            hasErrors: { type: "BOOLEAN" },
            report: { type: "STRING" },
          },
          required: ["hasErrors", "report"],
        },
      },
    });

    const factCheckResult = JSON.parse(factCheckResponse.text);

    const fcMeta = factCheckResponse.usageMetadata || {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    };
    totalTokens.input += fcMeta.promptTokenCount;
    totalTokens.output += fcMeta.candidatesTokenCount;
    totalTokens.total += fcMeta.totalTokenCount;

    let finalLogMessage = "";
    if (factCheckResult.hasErrors) {
      finalLogMessage = `[AI FACT-CHECK - ODRZUCENIE] Zablokowano próbę publikacji fake-news ("${title}"). Wykryto błędy w faktach. Zużycie API: In: ${totalTokens.input} | Out: ${totalTokens.output} | Total: ${totalTokens.total} tokenów.`;

      if (dbUser && typeof dbUser.updateOne === "function") {
        await dbUser.updateOne({ $inc: { aiBlockedFactCheckCount: 1 } });
      }
    } else {
      finalLogMessage = `[AI VALIDATOR - SUKCES] Post publiczny pomyślnie przeszedł dwuetapowy audyt ("${title}"). Zatwierdzono do publikacji globalnej. Zużycie API: In: ${totalTokens.input} | Out: ${totalTokens.output} | Total: ${totalTokens.total} tokenów.`;
    }

    await createLog(req, finalLogMessage, executionEmail);

    return {
      approved: !factCheckResult.hasErrors,
      reason: factCheckResult.hasErrors
        ? "Wykryto rażące błędy faktograficzne lub fake-news."
        : null,
      factCheckReport: factCheckResult.report,
    };
  } catch (err) {
    console.error(
      "Krytyczny błąd modułu walidacji AI (validatePublicContent):",
      err,
    );
    try {
      const { createLog } = require("./systemLog");
      await createLog(
        req,
        `[AI VALIDATOR AWARIA] Krytyczny błąd podczas weryfikacji wpisu. Powód: ${err.message}`,
        dbUser?.email || "System-Error",
      );
    } catch (e) {}

    return {
      approved: false,
      reason:
        "Wewnętrzny błąd serwera podczas weryfikacji treści przez sztuczną inteligencję.",
      factCheckReport: "Nie udało się wygenerować raportu.",
    };
  }
};

tools.validateId = function (idName) {
  return (req, res, next) => {
    console.log(req.params);
    const idValue = req.params[idName];

    // 1. Sprawdzenie, czy parametr w ogóle został przekazany
    if (!idValue) {
      return res.status(400).json({
        error: `Brak wymaganego parametru: ${idName}`,
      });
    }

    // 2. Sprawdzenie, czy format ObjectId jest poprawny
    if (!ObjectId.isValid(idValue)) {
      return res.status(400).json({
        error: `Niepoprawny format identyfikatora dla pola: ${idName}`,
      });
    }
    next();
  };
};

tools.handleApiValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMsg = errors
      .array()
      .map((e) => e.msg)
      .join(", ");
    return res.status(400).send(`Błąd walidacji: ${errorMsg}`);
  }
  next();
};

tools.handleRedirectValidationErrors = (redirectUrlPrefix) => {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMsg = errors
        .array()
        .map((e) => e.msg)
        .join(" ");

      // KRYTYCZNA POPRAWKA: Jeśli żądanie pochodzi z Fetch API (oczekuje JSON), zwracamy czysty kod 400
      if (
        req.xhr ||
        (req.headers.accept && req.headers.accept.indexOf("json") > -1)
      ) {
        return res.status(400).json({ error: errorMsg });
      }

      // Tradycyjny fallback dla klasycznych formularzy (przeładowanie)
      return res.redirect(
        `${redirectUrlPrefix}?error=server&customMsg=${encodeURIComponent(errorMsg)}`,
      );
    }
    next();
  };
};

tools.validateFileSignatures = (req, res, next) => {
  // 1. Obsługa req.file (np. pojedynczy obrazek posta)
  if (req.file) {
    if (!verifyBufferSignature(req.file.buffer, req.file.originalname)) {
      return res
        .status(400)
        .send(
          "Błąd walidacji pliku: Wykryto nieprawidłową sygnaturę (extension-spoofing).",
        );
    }
  }

  if (req.files) {
    for (const fieldName in req.files) {
      const filesArray = req.files[fieldName];
      for (const file of filesArray) {
        if (!verifyBufferSignature(file.buffer, file.originalname)) {
          return res
            .status(400)
            .send(
              `Błąd walidacji: Wykryto nieprawidłową sygnaturę pliku dla pola ${fieldName}.`,
            );
        }
      }
    }
  }
  next();
};

tools.postValidationRules = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Tytuł musi mieć od 1 do 100 znaków."),
  body("content")
    .notEmpty()
    .withMessage("Treść wpisu nie może być pusta.")
    .isLength({ max: 10000 })
    .withMessage("Treść wpisu jest zbyt długa (maksymalnie 10 000 znaków)."),
  body("visibility")
    .isIn(POST_VISIBILITY)
    .withMessage("Niepoprawny poziom widoczności."),
];

tools.commentValidationRules = [
  body("content")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Komentarz musi mieć od 1 do 500 znaków.")
    .escape(),
];

tools.loginValidationRules = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Wprowadź poprawny adres e-mail.")
    .normalizeEmail(),
  body("password").notEmpty().withMessage("Hasło nie może być puste."),
];

tools.registerValidationRules = [
  body("name")
    .trim()
    .isLength({ min: 3, max: 70 })
    .withMessage("Imię i Nazwisko / Pseudonim musi mieć od 3 do 70 znaków.")
    .matches(/^[A-Za-zZaąęćęłłnnóósśźźżź\s-]+$/)
    .withMessage("Pole może zawierać tylko litery, spacje i myślniki.")
    .escape(),

  body("email")
    .trim()
    .isEmail()
    .withMessage("Wprowadź poprawny adres e-mail.")
    .normalizeEmail({ gmail_remove_dots: false })
    .isLength({ max: 100 })
    .withMessage("Adres e-mail jest zbyt długi.")
    .custom(async (value) => {
      const { userExists } = require("./db");
      if (await userExists(value)) {
        throw new Error(
          "Podany adres e-mail jest już zajęty przez innego użytkownika.",
        );
      }
      return true;
    }),

  body("terms")
    .equals("on")
    .withMessage(
      "Musisz zaakceptować Regulamin platformy, aby utworzyć konto.",
    ),

  body("privacy")
    .equals("on")
    .withMessage(
      "Musisz zaakceptować Politykę prywatności, aby utworzyć konto.",
    ),
];

// Reguła walidacji dla drugiego etapu rejestracji (ustawianie hasła początkowego)
tools.setInitialPasswordValidationRules = [
  body("password").custom((value) => {
    if (!PASSWORD_REGEX.test(value)) {
      throw new Error(
        "Hasło musi mieć min. 8 znaków, zawierać małą i dużą literę oraz cyfrę.",
      );
    }
    return true;
  }),
  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("Wpisane hasła nie są identyczne.");
    }
    return true;
  }),
];

tools.settingsValidationRules = [
  body("name")
    .trim()
    .isLength({ min: 3, max: 70 })
    .withMessage("Imię i Nazwisko musi mieć od 3 do 70 znaków.")
    .matches(/^[A-Za-zZaąęćęłłnnóósśźźżź\s-]+$/)
    .withMessage(
      "Imię i Nazwisko może zawierać tylko litery, spacje i myślniki.",
    )
    .escape(),

  body("email")
    .trim()
    .isEmail()
    .withMessage("Wprowadź poprawny adres e-mail.")
    .normalizeEmail({ gmail_remove_dots: false }),

  body("alias")
    .optional({ checkFalsy: true })
    .trim()
    .toLowerCase()
    .isLength({ min: 3, max: 50 })
    .withMessage("Alias profilu musi mieć od 3 do 50 znaków.")
    .matches(/^[a-z0-9-]+$/)
    .withMessage(
      "Alias może zawierać wyłącznie małe litery, cyfry oraz myślniki.",
    )
    // KRYTYCZNA POPRAWKA: Przekazujemy req.dbUser._id do metody, aby nie blokować samego siebie
    .custom(async (value, { req }) => {
      const { aliasExists } = require("./db");
      const currentUserId = req.dbUser ? req.dbUser._id : null;

      if (await aliasExists(value, currentUserId)) {
        throw new Error("Ten alias jest zastrzeżony lub zajęty przez system.");
      }
      return true;
    })
    .escape(),
  body("bio")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 160 })
    .withMessage("Opis bio nie może przekraczać 160 znaków."),
  body("allowPrivateEmails")
    .optional({ checkFalsy: true })
    .customSanitizer(
      (value) => value === "on" || value === "true" || value === true,
    ),
];

tools.verifyValidationRules = [
  body("senderAccount")
    .trim()
    // 1. Akceptujemy spacje - usuwamy je przed dalszą walidacją za pomocą customSanitizer
    .customSanitizer((value) => (value || "").replace(/\s+/g, ""))
    .matches(/^\d{26}$/)
    .withMessage(
      "Numer konta musi składać się z dokładnie 26 cyfr (spacje są dozwolone).",
    )
    // 2. Walidacja cyfr kontrolnych standardu NRB/IBAN (Modulo 97)
    .custom((accountNumber) => {
      if (!accountNumber || accountNumber.length !== 26) return false;

      // Przekształcamy polski NRB na format międzynarodowy IBAN do celów walidacji matematycznej:
      // Przepisujemy numer konta, dodając na końcu kod kraju "PL" zamieniony na cyfry (2521)
      // oraz dwie pierwsze cyfry kontrolne z początku konta.
      const digitsControl = accountNumber.substring(2); // Odcinamy 2 pierwsze cyfry kontrolne
      const countryCode = "2521"; // "PL" w kodzie ASCII dla standardu IBAN (P=25, L=21)
      const firstTwoDigits = accountNumber.substring(0, 2); // Pobieramy 2 pierwsze cyfry kontrolne

      const preparedString = digitsControl + countryCode + firstTwoDigits;

      // Algorytm Modulo 97 na bardzo dużych liczbach (BigInt chroni przed utratą precyzji w JS)
      const isChecksumValid = BigInt(preparedString) % 97n === 1n;
      if (!isChecksumValid) {
        throw new Error(
          "Wprowadzony numer konta bankowego ma niepoprawną sumę kontrolną.",
        );
      }
      return true;
    }),
];

tools.adminApprovalValidationRules = [
  body("bankAccount")
    .trim()
    // 1. Akceptujemy spacje - usuwamy je przed dalszą walidacją matematyczną
    .customSanitizer((value) => (value || "").replace(/\s+/g, ""))
    .matches(/^\d{26}$/)
    .withMessage("Numer konta musi składać się z dokładnie 26 cyfr.")
    // 2. Walidacja cyfr kontrolnych standardu NRB/IBAN (Modulo 97)
    .custom((accountNumber) => {
      if (!accountNumber || accountNumber.length !== 26) return false;

      // Przekształcamy polski NRB na format międzynarodowy IBAN:
      // Przepisujemy numer konta, dodając na końcu kod kraju "PL" zamieniony na cyfry (2521)
      // oraz dwie pierwsze cyfry kontrolne z początku konta.
      const digitsControl = accountNumber.substring(2);
      const countryCode = "2521";
      const firstTwoDigits = accountNumber.substring(0, 2);

      const preparedString = digitsControl + countryCode + firstTwoDigits;

      // Algorytm Modulo 97 na bardzo dużych liczbach (BigInt chroni przed utratą precyzji w JS)
      const isChecksumValid = BigInt(preparedString) % 97n === 1n;
      if (!isChecksumValid) {
        throw new Error(
          "Wprowadzony numer konta bankowego ma niepoprawną sumę kontrolną (błąd cyfr kontrolnych).",
        );
      }
      return true;
    }),
];

tools.globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: "Zbyt wiele żądań z tego adresu IP, spróbuj ponownie później.",
});

tools.authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Wykryto zbyt wiele nieudanych prób logowania. Blokada na 10 minut.",
  standardHeaders: true,
  legacyHeaders: false,
});

tools.tokenGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minut
  max: 3, // Maksymalnie 3 żądania generowania tokenu na okno czasowe
  message:
    "Zbyt wiele żądań wygenerowania tokenu. Spróbuj ponownie za 15 minut.",
  standardHeaders: true,
  legacyHeaders: false,
});

tools.profileTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Osiągnięto limit zmian hasła. Spróbuj ponownie później.",
});
