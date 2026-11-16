const fs = require("fs");
const path = require("path");
const pug = require("pug");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const { ObjectId } = require("mongodb");
const sanitizeHtml = require("sanitize-html");
const { POST_VISIBILITY, PASSWORD_REGEX, ADMINS } = require("../config");
const { verifyBufferSignature } = require("./db");
const { renderMessage } = require("./pug2html");
const tools = { validationResult };
module.exports = tools;

// Funkcja walidacji zawartości edytora HTML
// tools/validation.js
// tools/validation.js
tools.validateContent = function (content) {
  if (!content || typeof content !== "string") return "";

  // 1. KROK: Sanityzacja HTML (zabezpieczenie XSS + wsparcie dla znacznika <lead>)
  let sanitized = sanitizeHtml(content, {
    allowedTags: [
      "lead",
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

  // 2. KROK: Wymuszenie pozycji zajawki (<lead>) wyłącznie jako pierwszego niepustego bloku
  let leadAllowedAtStart = true;
  sanitized = sanitized.replace(
    /<(\/?)lead\b[^>]*>/gi,
    (fullMatch, isClosing, offset, fullStr) => {
      if (!isClosing) {
        const prefixWithoutEmptyP = fullStr
          .slice(0, offset)
          .replace(/(?:\s|<p>(?:\s|<br\s*\/?>|&nbsp;|\u00a0)*<\/p>)/gi, "");

        if (leadAllowedAtStart && prefixWithoutEmptyP.length === 0) {
          leadAllowedAtStart = false;
          return "<lead>";
        }
        return "<p>";
      }
      return "</lead>";
    },
  );

  // Domknięcie par tagów <lead>...</lead> oraz zamiana nieuprawnionych domknięć na </p>
  let openLeads = 0;
  sanitized = sanitized.replace(/<(\/?)lead>/gi, (match, isClosing) => {
    if (!isClosing) {
      openLeads++;
      return "<lead>";
    }
    if (openLeads > 0) {
      openLeads--;
      return "</lead>";
    }
    return "</p>";
  });

  // 3. KROK: Bezpieczne czyszczenie twardych spacji tekstowych (z zachowaniem pustych linii <p>&nbsp;</p>)
  sanitized = sanitized.replace(/(?<!<p>)(&nbsp;|\u00a0)(?!\s*<\/p>)/g, " ");

  return sanitized;
};

// Sekcja integracji z Gemini AI

let cachedAiRules = "";
let lastTermsMtimeMs = 0;

/**
 * Pobiera z pliku views/terms.pug wyłącznie punkty oznaczone klasą .ai-rule
 * i buforuje je w pamięci do momentu modyfikacji pliku regulaminu.
 */
function getAiRulesFromTerms() {
  try {
    const termsPath = path.join(__dirname, "../views/terms.pug");
    const stats = fs.statSync(termsPath);

    if (cachedAiRules && stats.mtimeMs === lastTermsMtimeMs) {
      return cachedAiRules;
    }

    const compiledHtml = pug.renderFile(termsPath);
    const ruleMatches = [
      ...compiledHtml.matchAll(/<li[^>]*\bclass="[^"]*\bai-rule\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi),
    ];

    if (ruleMatches.length > 0) {
      cachedAiRules = ruleMatches
        .map((match, idx) => {
          const cleanRule = sanitizeHtml(match[1], {
            allowedTags: [],
            allowedAttributes: {},
          })
            .replace(/\s+/g, " ")
            .trim();
          return `${idx + 1}. ${cleanRule}`;
        })
        .join("\n");
      lastTermsMtimeMs = stats.mtimeMs;
    }

    return cachedAiRules;
  } catch (err) {
    console.error("[AI VALIDATOR] Błąd odczytu reguł .ai-rule z regulaminu:", err);
    return "";
  }
}

/**
 * ETAP 1: Multimodalny Audyt Bezpieczeństwa i zgodności z Regulaminem (Tekst + Grafika)
 */
tools.checkContentSafety = async function (ai, title, content, imageAsset = null) {
  const plainText = content.replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
  const hasImage = Boolean(imageAsset && imageAsset.buffer && imageAsset.mimetype);

  const fullTextToAnalyze = [
    `Tytuł artykułu: ${title}`,
    `Załączona grafika: ${hasImage ? "TAK (przesłana w załączniku)" : "NIE"}`,
    `Treść artykułu:\n${plainText}`,
  ].join("\n\n");

  const termsRules =
    getAiRulesFromTerms() ||
    "1. Zabrania się treści łamiących prawo, mowy nienawiści, dyskryminacji, wzywania do łamania prawa oraz pornografii.\n2. Zabrania się treści stanowiących reklamę produktów lub usług.\n3. Zabrania się wykorzystywania cudzego tekstu lub grafiki bez wyraźnego oznaczenia w tekście jego autora, oraz wskazania jego źródła.";

  const safetyInstruction = `Jesteś rygorystycznym, ale sprawiedliwym algorytmem moderującym treść na platformie publicystycznej Pole Opinii.
Przeanalizuj przesłany tekst ORAZ załączoną grafikę (jeśli została załączona) pod kątem naruszeń poniższych zasad Regulaminu Serwisu:

OBOWIĄZUJĄCE ZASADY REGULAMINU:
${termsRules}

SZCZEGÓŁOWE WYTYCZNE OCENY GRAFIKI I PRAW AUTORSKICH:
1. Bezpieczeństwo wizualne (jeśli załączono grafikę): Odrzuć obraz, jeśli zawiera treści pornograficzne/erotyczne, drastyczną przemoc (gore), symbole nienawiści/totalitarne, wulgarne napisy/memy, nawoływanie do przemocy lub bezpośrednią reklamę produktów/usług (banery reklamowe, kody rabatowe, logotypy promocyjne).
2. Weryfikacja autora i źródła grafiki (dotyczy punktu o wykorzystywaniu cudzej grafiki):
   - Jeśli załączono grafikę, sprawdź w treści artykułu, czy znajduje się informacja o autorze/źródle/licencji obrazu (np. „Fot. Jan Kowalski”, „Źródło: Wikimedia Commons”, „Grafika własna”, „CC BY-SA”, „domena publiczna”, „wygenerowano przez AI”).
   - ZAKAZ FAŁSZYWYCH ALARMÓW: Jeśli grafika wygląda na zwykłe, czyste zdjęcie lub ilustrację bez znaków wodnych, a autor nie podał źródła — NIE odrzucaj posta (domyślnie traktuj ją jako materiał własny autora).
   - ODRZUĆ POSTA (approved: false), jeśli zachodzi KTÓRYKOLWIEK z poniższych przypadków:
     a) Na grafice widoczny jest znak wodny banku zdjęć lub agencji prasowej (np. Shutterstock, Getty Images, iStock, Adobe Stock, Alamy, Depositphotos, PAP, Reuters, East News) LUB grafika jest zrzutem ekranu z cudzego portalu/telewizji/mediów społecznościowych, a w treści artykułu brak wyraźnego wskazania autora i źródła.
     b) W treści artykułu autor wyraźnie wskazuje, że grafika jest cudza (np. podaje nazwę innego portalu lub autora), ale podał tylko jedno z dwóch wymaganych elementów (brakuje albo autora, albo źródła).
     c) W treści artykułu znajduje się wyraźny, dosłowny cytat z cudzego utworu bez podania jego autora i źródła.

FORMAT ODPOWIEDZI:
Zwróć dane wyłącznie jako ustrukturyzowany obiekt JSON z polami:
- 'approved' (Boolean: true jeśli tekst i grafika spełniają wszystkie wymogi, false jeśli wykryto naruszenie).
- 'reason' (krótki, konkretny komunikat po polsku wyjaśniający użytkownikowi, który dokładnie punkt regulaminu został naruszony i co należy poprawić — np. „Załączona grafika posiada znak wodny agencji/banku zdjęć, a w treści artykułu brakuje wskazania jej autora oraz źródła.” — lub null, jeśli approved wynosi true).`;

  const contentsPayload = [fullTextToAnalyze];

  if (hasImage) {
    contentsPayload.push({
      inlineData: {
        data: imageAsset.buffer.toString("base64"),
        mimeType: imageAsset.mimetype,
      },
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: contentsPayload,
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

  return {
    result: JSON.parse(response.text),
    meta: response.usageMetadata || {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    },
  };
};

/**
 * ETAP 2: Autodetekcja błędów faktograficznych (Fact-Checking z Google Search)
 */
tools.checkContentFacts = async function (ai, title, content) {
  const fullTextToAnalyze = `Tytuł: ${title}\nTreść: ${content.replace(/<\/?[^>]+(>|$)/g, "")}`;
  const factCheckInstruction = `Jesteś niezależnym, obiektywnym ekspertem weryfikującym fakty (Fact-checker). 
  Przeanalizuj przesłany artykuł prasowy pod względem faktograficznym. Wykryj wszelkie kłamstwa, rażące manipulacje, nieprawdziwe daty, błędne nazwiska lub zmyślone wydarzenia historyczne/polityczne.
  Zwróć dane wyłącznie jako ustrukturyzowany obiekt JSON zawierający pola:
  - 'hasErrors' (wartość Boolean: true jeśli wykryto błędy faktograficzne lub fake news, false jeśli informacje są prawdziwe).
  - 'report' (szczegółowy, punktowy raport w języku polskim. Jeśli hasErrors wynosi true, wypisz konkretne błędy i podaj prawdę. Jeśli hasErrors wynosi false, napisz krótko: 'Weryfikacja pomyślna. Nie wykryto błędów faktograficznych.').`;

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: fullTextToAnalyze,
    config: {
      tools: [{ googleSearch: {} }], // Aktywacja Groundingu w chmurze Google
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

  return {
    result: JSON.parse(response.text),
    meta: response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
  };
};

/**
 * Centralny Koordynator Walidacji Publicznej (Tekst + Opcjonalna Grafika)
 */
tools.validatePublicContent = async function (
  req,
  title,
  content,
  res = null,
  fallbackImageAsset = null,
) {
  try {
    const { GoogleGenAI } = require("@google/genai");
    const { createLog } = require("./systemLog");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: "v1beta",
    });
    const dbUser = req.dbUser;
    const executionEmail = dbUser ? dbUser.email : "Anonimowy Twórca";
    const totalTokens = { input: 0, output: 0, total: 0 };

    // Priorytet ma nowo przesłany plik z Multera (req.file), a przy publikacji szkicu — obraz zapisany wcześniej na dysku
    const imageToAudit =
      req.file && req.file.buffer
        ? { buffer: req.file.buffer, mimetype: req.file.mimetype }
        : fallbackImageAsset;

    const safetyData = await tools.checkContentSafety(
      ai,
      title,
      content,
      imageToAudit,
    );
    totalTokens.input += safetyData.meta.promptTokenCount;
    totalTokens.output += safetyData.meta.candidatesTokenCount;
    totalTokens.total += safetyData.meta.totalTokenCount;

    if (!safetyData.result.approved) {
      await createLog(
        req,
        `[AI MODERACJA - BLOKADA] Odrzucono post publiczny ("${title}"). Powód: ${safetyData.result.reason}`,
        executionEmail,
      );
      if (dbUser && typeof dbUser.updateOne === "function") {
        await dbUser.updateOne({ $inc: { aiBlockedSafetyCount: 1 } });
      }

      const compiledHtml = renderMessage("aiRejection", {
        reason:
          safetyData.result.reason ||
          "Treść lub załączona grafika odrzucona przez filtry bezpieczeństwa.",
        report: safetyData.result.report || null,
      });

      return {
        approved: false,
        reason: compiledHtml,
      };
    }

    if (res && typeof res.write === "function") {
      res.write(
        `data: ${JSON.stringify({ status: "stage1_success", message: "✨ Weryfikacja treści i grafiki przeszła pomyślnie. Publikowanie..." })}\n\n`,
      );
    }

    await createLog(
      req,
      `[AI VALIDATOR - SUKCES] Post publiczny przeszedł audyt regulaminu ("${title}"). Zużycie tokenów: ${totalTokens.total}`,
      executionEmail,
    );

    return {
      approved: true,
      reason: null,
    };
  } catch (err) {
    console.error("Krytyczny błąd modułu walidacji AI:", err);

    const errorHtml = renderMessage("aiRejection", {
      reason: "Wewnętrzny błąd serwera podczas weryfikacji treści lub grafiki.",
      report: null,
    });

    return {
      approved: false,
      reason: errorHtml,
    };
  }
};
tools.validateId = function (idName) {
  return (req, res, next) => {
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
  // Funkcja pomocnicza do wyciągania sygnatury HEX do komunikatu błędu
  const getBufferHex = (buffer) => {
    return buffer && Buffer.isBuffer(buffer) 
      ? buffer.toString("hex", 0, 4).toLowerCase() 
      : "brak bufora";
  };

  if (req.file) {
    if (!verifyBufferSignature(req.file.buffer, req.file.originalname)) {
      const detectedHex = getBufferHex(req.file.buffer);
      return res
        .status(400)
        .send(`Błąd walidacji pliku: Nieprawidłowa sygnatura (Wykryto binarne bajty: ${detectedHex}).`);
    }
  }

  if (req.files) {
    for (const fieldName in req.files) {
      const filesArray = req.files[fieldName];
      for (const file of filesArray) {
        if (!verifyBufferSignature(file.buffer, file.originalname)) {
          const detectedHex = getBufferHex(file.buffer);
          return res
            .status(400)
            .send(`Błąd walidacji: Nieprawidłowa sygnatura pola ${fieldName} (Wykryto binarne bajty: ${detectedHex}).`);
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
    .isLength({ max: 20000 })
    .withMessage("Treść wpisu jest zbyt długa (maksymalnie 20 000 znaków)."),
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
    .matches(/^[\p{L}\s-]+$/u)
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
    .matches(/^[\p{L}\s-]+$/u)
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
    // matches sprawdza teraz w 100% czysty string (bo wyczyścił go router w admin.js)
    .matches(/^\d{26}$/)
    .withMessage("Numer konta musi składać się z dokładnie 26 cyfr.")
    .custom((accountNumber) => {
      if (!accountNumber || accountNumber.length !== 26) return false;

      const digitsControl = accountNumber.substring(2);
      const countryCode = "2521";
      const firstTwoDigits = accountNumber.substring(0, 2);

      const preparedString = digitsControl + countryCode + firstTwoDigits;

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
  windowMs: 15 * 60 * 1000, // 15 minut
  max: 1000, // Zwiększono z 200 na 1000 żądań na okno czasowe
  standardHeaders: true,
  legacyHeaders: false,
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

tools.adminScannerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // Okno 1 godziny
  max: 5, // Maksymalnie 5 prób wejścia/skanowania na godzinę dla niezalogowanych
  message: "Dostęp zablokowany z powodu podejrzanej aktywności sieciowej.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Pomijamy blokadę, jeśli użytkownik jest zalogowanym administratorem
    return (
      req.session?.user?.id && ADMINS.includes(req.session.user.id.toString())
    );
  },
});

// tools/validation.js

/**
 * Zcentralizowana funkcja weryfikacji tokenu reCAPTCHA v3 Enterprise
 * @param {string} token - Wygenerowany na froncie token
 * @param {string} remoteIp - Adres IP klienta
 * @returns {Promise<boolean>} - true jeśli zweryfikowano pomyślnie, false jeśli bot/błąd
 */
tools.verifyRecaptcha = async function (token, remoteIp) {
  const { useRecaptcha, RECAPTCHA_SECRET_KEY } = require("../config");

  // Jeśli funkcja jest wyłączona systemowo
  if (!useRecaptcha || token === "BYPASS_TOKEN_CAPTCHA_DISABLED") {
    return true;
  }

  if (!token) return false;

  try {
    // Punkt końcowy dla Enterprise i v3 jest tożsamy w klasycznym iq-verifikatorze klucza sekretnego
    const verificationUrl = "https://www.google.com/recaptcha/api/siteverify";
    const params = new URLSearchParams({
      secret: RECAPTCHA_SECRET_KEY,
      response: token,
      remoteip: remoteIp || "127.0.0.1",
    });

    const response = await fetch(verificationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await response.json();

    // Rating poniżej 0.5 oznacza ruch automatyczny (boty)
    if (data.success && (data.score === undefined || data.score >= 0.5)) {
      return true;
    }

    // Rejestracja incydentu naruszenia do audit-logu aplikacji
    const { SystemLog } = require("./db");
    console.log(
      `[reCAPTCHA ENTERPRISE BLOKADA] Odrzucono podejrzany ruch z IP: ${remoteIp}. Score: ${data.score || 0}`,
    );

    await SystemLog.create({
      fallbackName: "System-Ochrony",
      action: `[reCAPTCHA BLOKADA] Zablokowano automatyczną próbę uderzenia. Wynik punktowy: ${data.score || 0}`,
      ipAddress: remoteIp || "127.0.0.1",
    });

    return false;
  } catch (err) {
    console.error("Krytyczny błąd połączenia z API reCAPTCHA Google:", err);
    return false;
  }
};
