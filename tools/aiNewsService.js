// tools/aiNewsService.js
const cron = require("node-cron");
const { TopicOfTheDay } = require("./db");
const { SystemLog, createLog } = require("./systemLog");
const { OpenAI } = require("openai");
const { GoogleGenAI } = require("@google/genai");

const { AI_CONFIG } = require("../config");
const PROVIDER = process.env.AI_PROVIDER || AI_CONFIG.DEFAULT_PROVIDER;

/**
 * Pomocnicza funkcja pobierająca z bazy tytuły z ostatnich 24 godzin, aby AI ich nie dublowało
 */
async function getExistingTitles() {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingEvents = await TopicOfTheDay.find({
      fetchedAt: { $gte: oneDayAgo },
    })
      .select("title -_id")
      .lean();
    return existingEvents.map((e) => e.title);
  } catch (error) {
    console.error("[AI NEWS] Błąd pobierania istniejących tytułów:", error);
    return [];
  }
}

/**
 * Zapisuje wiadomości, ignorując duplikaty po tytule i ustawia indeks TTL
 */
async function saveUniqueToDatabase(topics, maxTopics) {
  if (!topics || topics.length === 0) return 0;

  // Tworzymy indeks TTL (np. wygasanie po 24 godzinach)
  // Możesz zmienić na 30 dni: 30 * 24 * 60 * 60
  const EXPIRE_SECONDS = 24 * 60 * 60;
  await TopicOfTheDay.collection.createIndex(
    { fetchedAt: 1 },
    { expireAfterSeconds: EXPIRE_SECONDS },
  );

  // Przygotowanie operacji bulkWrite (zapis wyłącznie unikalnych nowości)
  const operations = topics.slice(0, maxTopics).map((event) => ({
    updateOne: {
      filter: { title: event.title.trim() },
      update: {
        $setOnInsert: {
          title: event.title.trim(),
          summary: event.summary.trim(),
          importance: parseInt(event.importance) || 5,
          fetchedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  const result = await TopicOfTheDay.collection.bulkWrite(operations);
  return result.upsertedCount; // Zwraca liczbę faktycznie dodanych nowych newsów
}

async function fetchFromOpenAI(prompt, systemInstruction = null) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = JSON.parse(response.choices.message.content);
  const usage = response.usage || {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  return {
    topics: content.topics || content.events || Object.values(content),
    tokens: {
      input: usage.prompt_tokens,
      output: usage.completion_tokens,
      total: usage.total_tokens,
    },
  };
}

async function fetchFromGemini(prompt, systemInstruction = null) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: "v1beta",
  });
  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction: systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          topics: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: {
                  type: "STRING",
                  description: "Zwięzły tytuł maksymalnie 50 znaków",
                },
                summary: {
                  type: "STRING",
                  description:
                    "Opis zdarzenia w maksymalnie 4 zdaniach. Na początku podaj w nawiasie datę dzienną zdarzenia w formacie dd.mm",
                },
                field: {
                  type: "STRING",
                  description: "dział informacyjny",
                },
                importance: {
                  type: "INTEGER",
                  description:
                    "Ocena ważności wydarzenia w skali od 1 do 10 (gdzie: 1-3 to lokalne/mało istotne debaty; 4-6 to standardowe ustawy, dymisje, istotne konferencje; 7-9 to kluczowe reformy, kryzysy rządowe, umowy międzynarodowe; 10 to wydarzenia przełomowe o charakterze historycznym dla kraju).",
                },
                date: {
                  type: "INTEGER",
                  description: "Data dzienna zdarzenia",
                },
              },
              required: ["title", "summary", "importance", "date"],
            },
          },
        },
        required: ["topics"],
      },
    },
  });

  const content = JSON.parse(response.text);
  const metadata = response.usageMetadata || {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
  };

  return {
    topics: content.topics,
    tokens: {
      input: metadata.promptTokenCount,
      output: metadata.candidatesTokenCount,
      total: metadata.totalTokenCount,
    },
  };
}

async function fetchAndSaveDailyTopics() {
  try {
    console.log(
      `[AI NEWS] Synchronizacja tematów dnia (${PROVIDER.toUpperCase()})...`,
    );

    const maxTopics = AI_CONFIG.MAX_TOPICS || 5;

    // --- DYNAMICZNE WYZNACZANIE SZTYWNYCH RAM CZASOWYCH (DZIŚ I WCZORAJ) ---
    const now = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const dateToday = now.toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const dateYesterday = yesterday.toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const dayOfWeek = now.toLocaleDateString("pl-PL", { weekday: "long" });

    // Mechanizm exclusion (ignorowanie istniejących tytułów)
    const ignoredTitles = await getExistingTitles();
    let ignoreInstruction = "";
    if (ignoredTitles.length > 0) {
      ignoreInstruction = `BEZWZGLĘDNIE POMIŃ i nie dubluj następujących tematów prasowych, ponieważ są już w bazie:\n- ${ignoredTitles.join("\n- ")}`;
    }

    const systemInstruction = `Działasz jako rzetelny redaktor agencji prasowej. Przygotowujesz przegląd dokładnie 5 najważniejszych, prawdziwych wydarzeń z ostatniej doby.

    ZASADY WERYFIKACJI FAKTÓW:
    - Opieraj się wyłącznie na rzeczywistych wynikach z narzędzia Google Search.
    - Jeśli nie znajdziesz potwierdzenia jakiegoś wydarzenia w realnych serwisach informacyjnych z ostatniej doby, traktuj je jako niebyłe.
    - Kategorycznie zakazuję generowania fikcyjnych scenariuszy, rozejmów, przełomów naukowych czy traktatów, które nie miały miejsca w rzeczywistości.

    KRYTERIA SELEKCJI:
    - Wybieraj tematy o najwyższej wadze: geopolityka, kluczowe decyzje rządowe, makroekonomia, katastrofy o skali krajowej/globalnej.
    - Odrzucaj: ciekawostki, premiery produktów, spekulacje oraz "ogólne" trendy bez konkretnego wydarzenia z dzisiaj.        
    `;

    const prompt = `Przeszukaj najświeższe wiadomości z ostatniej doby i wybierz 5 - 10 najważniejszych, realnych wydarzeń na świecie i w kraju. 

    Zwróć dane jako obiekt JSON z kluczem 'topics', zawierający listę obiektów z polami 'title' (max 40 znaków), 'summary' (max 4 zdania po polsku) i 'importance' (liczba 1-10). Używaj polskich liter w standardzie utf-8.

    Upewnij się, że informacje są aktualne i prawdziwe. ${ignoreInstruction}`;

    let resultData;
    if (PROVIDER.toLowerCase() === "gemini") {
      resultData = await fetchFromGemini(prompt);
    } else {
      resultData = await fetchFromOpenAI(prompt);
    }

    const { topics, tokens } = resultData; // Dane o tokenach są tu poprawnie pobierane

    if (Array.isArray(topics) && topics.length > 0) {
      // Zapis operacją bulkWrite z indeksem TTL
      const newInsertedCount = await saveUniqueToDatabase(topics, maxTopics);

      // KRYTYCZNA POPRAWKA: Przywrócenie wyświetlania statystyk w konsoli serwera
      console.log(
        `[AI NEWS] Przetworzono wpisy. Dodano nowych unikalnych dokumentów: ${newInsertedCount}. Zużycie tokenów -> In: ${tokens.input}, Out: ${tokens.output}, Total: ${tokens.total}`,
      );

      const dummyReq = {
        ip: "127.0.0.1",
        session: { user: { email: `System-AI-${PROVIDER}` } },
      };

      // Przywrócenie zapisu pełnego logu audytowego z tokenami do bazy MongoDB
      const logMessage = `[AI INTEGRACJA] Pomyślnie zsynchronizowano newsy (${PROVIDER.toUpperCase()}). Nowych unikalnych: ${newInsertedCount}. Zużycie tokenów -> In: ${tokens.input} | Out: ${tokens.output} | Total: ${tokens.total}`;
      await createLog(dummyReq, logMessage);
    }
  } catch (err) {
    console.error(`[AI NEWS ERROR]:`, err);
    const dummyReq = {
      ip: "127.0.0.1",
      session: { user: { email: `System-AI-Error` } },
    };
    await createLog(
      dummyReq,
      `[AI BŁĄD] Nie udało się odświeżyć tematów. Powód: ${err.message}`,
    );
  }
}

function initializeNewsCron(update = false) {
  // SZYBKI ZMYWAK BAZODANOWY:
  // TopicOfTheDay.deleteMany({}).then(() => console.log("💥 BAZA WYCZYSZCZONA POMYŚLNIE"));

  const schedule = AI_CONFIG.CRON_SCHEDULE || "0 4 * * *";
  console.log(
    `[AI NEWS] Harmonogram zadań Cron zainicjowany na regułę: "${schedule}"`,
  );

  cron.schedule(schedule, () => {
    fetchAndSaveDailyTopics();
  });

  if (update) fetchAndSaveDailyTopics();
}

module.exports = { initializeNewsCron, fetchAndSaveDailyTopics };
