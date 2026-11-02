// routes/editors.js
const express = require("express");
const { ObjectId } = require("mongodb");
const { User, getScopedPosts, TopicOfTheDay, createLog } = require("../tools/db");
const { accessControl } = require("../tools/security");
const { AI_CONFIG } = require("../config");
const {validateId} = require("../tools/validation");

module.exports = express.Router()
  .use(accessControl)
  .use((req, res, next) => 
    (req?.dbUser?.role === "editor") ? next() : res.status(403).send("Brak uprawnień")
  )
  .get("/", getMain)
  .use("/topics/:topicId", validateId("topicId"))
  .delete("/topics/:topicId", deleteTopic)
  .post("/topics/:topicId/generate-article", postGenerateArticle)

  .use("/posts/:postId", validateId("postId"))
  .post("/posts/:postId/check", postCheck)
  
// 2. WIDOK GŁÓWNY POKOJU REDAKCJI
async function getMain(req, res) {
  try {
    const limit = 20;

    // Pobieramy posty przeznaczone wyłącznie dla pokoju redaktorów
    const { posts, totalPosts } = await getScopedPosts(req, {
      scope: "editors",
      limit,
    });

    // Pobieramy pełną listę redaktorów dla lewego paska bocznego
    const editorsList = await User.find({ role: "editor" })
      .select("name avatarUrl nickname alias")
      .sort({ name: 1 })
      .lean();

    // Pobieramy tematy dnia AI dla prawego paska bocznego
    const maxTopics = AI_CONFIG.MAX_TOPICS || 10;
    const dailyTopics = await TopicOfTheDay.find({})
      .sort({ importance: -1, fetchedAt: -1 })
      .limit(maxTopics)
      .lean();

    res.render("editors", {
      title: "Kolegium Redakcyjne (Wewnętrzne)",
      posts,
      editorsList,
      dailyTopics,
      hasMore: totalPosts > limit,
      currentTab: "editors",
      defaultVisibility: "editors" 
    });
  } catch (err) {
    console.error("Błąd ładowania pokoju redakcyjnego:", err);
    res.status(500).send("Wewnętrzny błąd serwera");
  }
}

// 3. ENDPOINT USUNIĘCIA NEWSU
async function deleteTopic(req, res) {
  try {
    const { topicId } = req.params;

    if (!ObjectId.isValid(topicId)) {
      return res.status(400).send("Nieprawidłowy identyfikator tematu.");
    }

    const deletedTopic = await TopicOfTheDay.findByIdAndDelete(topicId);

    if (!deletedTopic) {
      return res
        .status(404)
        .send("Nie odnaleziono podanego tematu w bazie danych.");
    }

    // Rejestracja zdarzenia w logach audytowych platformy
    await createLog(
      req,
      `[MODERACJA AI] Redaktor usunął ręcznie temat dnia z poziomu strefy edytorskiej: "${deletedTopic.title}"`
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd podczas usuwania tematu AI przez redaktora:", err);
    return res
      .status(500)
      .send("Wewnętrzny błąd serwera podczas usuwania zasobu.");
  }
}

async function postGenerateArticle(req, res){
  try {
    const { topicId } = req.params;
    const dbUser = req.dbUser;

    const topic = await TopicOfTheDay.findById(topicId);
    if (!topic) {
      return res.status(404).send("Nie odnaleziono podanego newsa w bazie danych.");
    }

    const PROVIDER = process.env.AI_PROVIDER || AI_CONFIG.DEFAULT_PROVIDER;
    let generatedContentHtml = "";

    const systemInstruction = `Działasz jako elitarny publicysta i dziennikarz śledczy agencji prasowej. 
    Na podstawie krótkiego streszczenia wiadomości masz stworzyć kompletny, głęboki, profesjonalny i analityczny artykuł prasowy w języku polskim.
    
    WYMOGI STRUKTURALNE (ZWRÓĆ CZYSTY HTML DO EDYTORA QUILL):
    - Artykuł musi zawierać chwytliwy wstęp (lead), rozwinięcie podzielone na podsekcje z nagłówkami (używaj <h2> i <h3>) oraz merytoryczne podsumowanie.
    - Używaj tagów <p>, <strong>, <em> dla wyróżnień oraz ewentualnie <blockquote> dla symulacji cytatów eksperckich.
    - Tekst musi być rozbudowany, bogaty słownictwowo, obiektywny i brzmieć w 100% naturalnie (jak tekst z wiodących portali opinii).
    - Zwróć WYŁĄCZNIE kod HTML gotowy do wklejenia — nie owijaj go w znaczniki markdown \`\`\`html \`\`\`.`;

    const prompt = `Temat wydania: ${topic.title}\nKrótkie kalendarium/fakty: ${topic.summary}\n\nOpracuj ten temat w formie pełnowymiarowego, głębokiego artykułu publicystycznego.`;

    // 1. ODPYTANIE WYBRANEGO W CONFIG DOSTAWCY LLM (Zasada spójności architektury systemu)
    if (PROVIDER.toLowerCase() === "gemini") {
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: "v1beta" });
      
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
        }
      });
      generatedContentHtml = response.text;
    } else {
      const { OpenAI } = require("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ]
      });
      generatedContentHtml = response.choices[0].message.content;
    }

    // Sanityzacja / Czyszczenie ewentualnych tagów markdown \`\`\`html dodanych przez model
    generatedContentHtml = generatedContentHtml
      .replace(/```html/gi, "")
      .replace(/```/g, "")
      .trim();

    // 2. TWORZENIE NOWEGO POSTA JAKO PRYWATNY SZKIC (DRAFT) DLA REDAKTORA
    const { Post } = require("../tools/db");
    const newPost = new Post({
      title: `[AI SZKIC] ${topic.title}`,
      author: dbUser.displayName,
      authorEmail: dbUser.email,
      authorId: dbUser._id,
      authorAvatar: dbUser.avatarUrl,
      content: generatedContentHtml,
      visibility: "private", // Bezwzględnie prywatny szkic do dalszej weryfikacji ludzkiej
      imageUrl: null,
      parentPostId: null,
    });

    const savedPost = await newPost.save();

    // Rejestracja audytu
    await createLog(
      req,
      `[AI KREATOR] Redaktor ${dbUser.name} wygenerował automatyczny szkic artykułu prasowego dla tematu: "${topic.title}"`
    );

    return res.json({
      success: true,
      message: "Artykuł prasowy został pomyślnie wygenerowany przez sztuczną inteligencję i umieszczony jako prywatny szkic w Twoim profilu.",
      postId: savedPost._id
    });

  } catch (err) {
    console.error("Błąd podczas automatycznego generowania tekstu przez AI:", err);
    return res.status(500).send("Wewnętrzny błąd serwera podczas generowania treści.");
  }
}

// routes/editors.js -> Nowy asynchroniczny endpoint asysty dziennikarskiej

async function postCheck(req, res){
  try {
    const { postId } = req.params;
    const { GoogleGenAI } = require("@google/genai");
    const { checkContentFacts } = require("../tools/validation");

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send("Nieprawidłowy identyfikator artykułu.");
    }

    // Bezpieczeństwo: Pobieramy post przez getScopedPosts, aby upewnić się,
    // że redaktor ma prawo go widzieć w swojej bieżącej sesji (public/restricted/editors/własny prywatny)
    const { posts } = await getScopedPosts(req, {
      scope: "single",
      targetPostId: postId,
      limit: 1,
    });

    if (!posts || posts.length === 0) {
      return res.status(403).send("Brak uprawnień: Nie możesz audytować artykułu, do którego nie masz dostępu.");
    }

    const post = posts[0];

    // Inicjalizacja instancji AI
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: "v1beta" });
    
    // Uruchamiamy odizolowany moduł fact-checkingu z groundingiem w wyszukiwarce Google
    const factCheckAnalysis = await checkContentFacts(ai, post.title, post.content);

    // Rejestrujemy zapytanie w logu systemowym
    await createLog(
      req, 
      `[ASYSTA REDAKTORSKA AI] Redaktor ${req.dbUser.name} wywołał fact-checking dla posta o ID: ${post._id} (autor: ${post.author})`
    );

    return res.json({
      success: true,
      hasErrors: factCheckAnalysis.result.hasErrors,
      report: factCheckAnalysis.result.report
    });

  } catch (err) {
    console.error("Błąd potoku asysty redakcyjnej AI:", err);
    return res.status(500).send("Wewnętrzny błąd serwera podczas analityki tekstu.");
  }
}
