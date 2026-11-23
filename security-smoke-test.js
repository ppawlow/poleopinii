// security-smoke-test.js
// Automatyczny skrypt testów bezpieczeństwa i regresji z auto-tworzeniem i czyszczeniem kont w MongoDB

require("dotenv").config();
const mongoose = require("mongoose");
const { createVerifiedUser, rmUser } = require("./tools/db");
const { useRecaptcha } = require("./config");
const isCaptchaActive = Boolean(useRecaptcha && useRecaptcha !== "false");

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";

class TestSessionClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = "";
  }

  _extractCookies(res) {
    const setCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx).trim();
        const val = pair.slice(eqIdx + 1).trim();
        this.cookies.set(key, val);
      }
    }
  }

  _cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async fetchCsrf(path = "/auth/login") {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Cookie: this._cookieHeader() },
    });
    this._extractCookies(res);
    const html = await res.text();
    const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    if (match) {
      this.csrfToken = match[1];
    }
    return res;
  }

  async login(email, password) {
    await this.fetchCsrf("/auth/login");
    const res = await this.postForm("/auth/login", {
      email,
      password,
      recaptchaToken: "",
    });
    await this.fetchCsrf("/");
    const location = res.headers.get("location") || "";
    return res.status === 302 && location === "/";
  }

  async postForm(path, dataObj, extraHeaders = {}) {
    if (!this.csrfToken) await this.fetchCsrf();
    const body = new URLSearchParams(dataObj).toString();

    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "X-CSRF-Token": this.csrfToken,
        Cookie: this._cookieHeader(),
        ...extraHeaders,
      },
      body,
    });
    this._extractCookies(res);
    return res;
  }

  async postMultipart(path, fieldsObj) {
    if (!this.csrfToken) await this.fetchCsrf();
    const formData = new FormData();
    for (const [k, v] of Object.entries(fieldsObj)) {
      formData.append(k, v);
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": this.csrfToken,
        Cookie: this._cookieHeader(),
      },
      body: formData,
    });
    this._extractCookies(res);
    return res;
  }

  async get(path) {
    const res = await fetch(`${BASE_URL}${path}`, {
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Cookie: this._cookieHeader(),
      },
    });
    this._extractCookies(res);
    return res;
  }
}

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName} ${details ? "-> " + details : ""}`);
    failed++;
  }
}

async function runTests() {
  console.log(`\n🚀 Uruchamianie testów bezpieczeństwa na: ${BASE_URL}\n`);

  const suffix = Date.now();
  const userAData = {
    name: "Test Autor Alfa",
    email: `test.alfa.${suffix}@example.com`,
    alias: `test-alfa-${suffix}`,
    password: "TestPassword123",
    role: "user",
    allowPrivateEmails: true,
  };

  const userBData = {
    name: "Test Czytelnik Beta",
    email: `test.beta.${suffix}@example.com`,
    alias: `test-beta-${suffix}`,
    password: "TestPassword123",
    role: "user",
    allowPrivateEmails: true,
  };

  let createdUserA = null;
  let createdUserB = null;

  try {
    // ============================================
    // 0. PRZYGOTOWANIE TYMCZASOWYCH KONT W MONGODB
    // ============================================
    console.log("🛠️  Tworzenie tymczasowych kont testowych w bazie MongoDB...");
    createdUserA = await createVerifiedUser(userAData);
    createdUserB = await createVerifiedUser(userBData);

    if (createdUserA?.error || createdUserB?.error) {
      throw new Error(
        `Nie udało się utworzyć kont testowych: ${createdUserA?.message || createdUserB?.message}`,
      );
    }
    console.log(
      `   Utworzono: ${userAData.email} (ID: ${createdUserA._id}) oraz ${userBData.email} (ID: ${createdUserB._id})\n`,
    );

    // ===================================
    // CZĘŚĆ A: TESTY BEZ LOGOWANIA (GOŚĆ)
    // ===================================
    const guest = new TestSessionClient("Gość");
    await guest.fetchCsrf("/auth/login");

    {
      const res = await guest.postForm("/posts/report", {
        parentPostId: "invalid-id",
        reporterEmail: "test@example.com",
        content: "Testowe uzasadnienie zgłoszenia",
        recaptchaToken: "",
      });
      const text = await res.text();

      if (isCaptchaActive) {
        assert(
          res.status === 403,
          "reCAPTCHA (AKTYWNA): Pusty token jest prawidłowo blokowany (403)",
          `Status: ${res.status}`,
        );
      } else {
        assert(
          res.status === 400 && !text.includes("Brak tokenu weryfikacji"),
          "reCAPTCHA (WYŁĄCZONA): Pusty token nie blokuje formularza",
          `Status: ${res.status}`,
        );
      }
    }

    {
      const res1 = await guest.get("/posts/niepoprawne-id-123");
      assert(
        res1.status === 400,
        "Walidacja ID: GET /posts/:id odrzuca błędne ObjectId kodem 400",
        `Otrzymano: ${res1.status}`,
      );

      const res2 = await guest.postForm(
        "/admin/users/niepoprawne-id/promote",
        {},
      );
      assert(
        res2.status === 403,
        "Admin Control: Niezalogowany użytkownik dostaje 403 na /admin/*",
        `Otrzymano: ${res2.status}`,
      );
    }

    {
      const fakePostId = "6adeff567d07c910c127ed5c";
      const resLike = await guest.postForm(`/posts/${fakePostId}/like`, {});
      assert(
        resLike.status === 401,
        "Auth Guard: POST /posts/:id/like wymaga logowania (401)",
        `Otrzymano: ${resLike.status}`,
      );

      const resFc = await guest.postForm(
        `/posts/${fakePostId}/factcheck-reader`,
        {},
      );
      assert(
        resFc.status === 401,
        "Auth Guard: POST /posts/:id/factcheck-reader wymaga logowania (401)",
        `Otrzymano: ${resFc.status}`,
      );
    }

    {
      const wsUrl = BASE_URL.replace(/^http/, "ws") + "/?path=/";
      const cswshBlocked = await new Promise((resolve) => {
        try {
          const ws = new WebSocket(wsUrl, {
            headers: { Origin: "https://evil-attacker-site.com" },
          });
          ws.onopen = () => {
            ws.close();
            resolve(false);
          };
          ws.onerror = () => resolve(true);
          ws.onclose = () => resolve(true);
        } catch (e) {
          resolve(true);
        }
      });

      assert(
        cswshBlocked === true,
        "WebSocket CSWSH: Połączenie z obcego Origin jest odrzucane",
      );
    }

    // =========================================================================
    // CZĘŚĆ B: TESTY ZALOGOWANYCH UŻYTKOWNIKÓW (IDOR, RESTRICTED, BIO, LIMITER)
    // =========================================================================
    if (isCaptchaActive) {
      console.log(
        "\nℹ️  Pominięto logowanie automatyczne UserA/UserB (USE_RECAPTCHA jest włączone i blokuje żądania bez przeglądarki).\n",
      );
    } else {
      const clientA = new TestSessionClient("UserA");
      const clientB = new TestSessionClient("UserB");

      const loggedA = await clientA.login(userAData.email, userAData.password);
      const loggedB = await clientB.login(userBData.email, userBData.password);

      assert(loggedA, "Logowanie tymczasowego konta UserA");
      assert(loggedB, "Logowanie tymczasowego konta UserB");

      if (loggedA && loggedB) {
        // 1. Walidacja długości Bio (max 160 znaków)
        const resLongBio = await clientA.postForm("/profile/update-bio", {
          bio: "A".repeat(161),
        });
        assert(
          resLongBio.status === 400,
          "Walidacja Bio: Odrzucenie opisu dłuższego niż 160 znaków (400)",
          `Otrzymano: ${resLongBio.status}`,
        );

        const resValidBio = await clientA.postForm("/profile/update-bio", {
          bio: "Poprawny opis biogramu testowego.",
        });
        assert(
          resValidBio.status === 200,
          "Regresja Bio: Poprawny opis (<= 160 znaków) zapisuje się pomyślnie (200)",
          `Otrzymano: ${resValidBio.status}`,
        );

        // 2. Test IDOR na wpisie PRYWATNYM (private)
        const createPrivateRes = await clientA.postMultipart("/posts", {
          title: "Testowy wpis prywatny IDOR",
          content: "<p>Tajna treść szkicu</p>",
          visibility: "private",
        });

        let privatePostId = null;
        if (createPrivateRes.ok) {
          const data = await createPrivateRes.json();
          const idMatch = (data.html || "").match(/id="post-([a-f0-9]{24})"/);
          if (idMatch) privatePostId = idMatch[1];
        }

        assert(
          Boolean(privatePostId),
          "Tworzenie prywatnego posta przez UserA",
          privatePostId
            ? `ID: ${privatePostId}`
            : `Status: ${createPrivateRes.status}`,
        );

        if (privatePostId) {
          const idorView = await clientB.get(`/posts/${privatePostId}`);
          assert(
            idorView.status === 403,
            "IDOR View (private): UserB nie może wyświetlić prywatnego posta UserA (403)",
            `Otrzymano: ${idorView.status}`,
          );

          const idorLike = await clientB.postForm(
            `/posts/${privatePostId}/like`,
            {},
          );
          assert(
            idorLike.status === 403,
            "IDOR Like (private): UserB nie może polubić prywatnego posta UserA (403)",
            `Otrzymano: ${idorLike.status}`,
          );

          const idorComment = await clientB.postForm(
            `/posts/${privatePostId}/comment`,
            { content: "Nieuprawniony komentarz" },
          );
          assert(
            idorComment.status === 403,
            "IDOR Comment (private): UserB nie może skomentować prywatnego posta UserA (403)",
            `Otrzymano: ${idorComment.status}`,
          );
          const idorFc = await clientB.postForm(
            `/posts/${privatePostId}/factcheck-reader`,
            {},
          );
          assert(
            idorFc.status === 403,
            "IDOR Fact-Check (private): UserB nie może zlecić analizy AI prywatnego posta (403)",
            `Otrzymano: ${idorFc.status}`,
          );
        }

        // 3. Test IDOR i regresji na wpisie ZASTRZEŻONYM (restricted)
        const createRestrictedRes = await clientA.postMultipart("/posts", {
          title: "Testowy wpis dla obserwujących",
          content: "Treść tylko dla obserwujących",
          visibility: "restricted",
        });
        let restrictedPostId = null;
        if (createRestrictedRes.ok) {
          const data = await createRestrictedRes.json();
          const idMatch = (data.html || "").match(/id="post-([a-f0-9]{24})"/);
          if (idMatch) restrictedPostId = idMatch[1];
        }
        if (restrictedPostId) {
          // UserB NIE obserwuje jeszcze UserA -> próba polubienia powinna zwrócić 403
          const idorRestrictedLike = await clientB.postForm(
            `/posts/${restrictedPostId}/like`,
            {},
          );
          assert(
            idorRestrictedLike.status === 403,
            "IDOR Like (restricted): Nieobserwujący UserB dostaje 403",
            `Otrzymano: ${idorRestrictedLike.status}`,
          );
          // UserB zaczyna obserwować UserA -> polubienie i komentarz muszą zadziałać (regresja)
          await clientB.postForm(`/follow/${createdUserA._id}`, {});
          const allowedLike = await clientB.postForm(
            `/posts/${restrictedPostId}/like`,
            {},
          );
          assert(
            allowedLike.status === 200,
            "Regresja Like (restricted): Obserwujący UserB może polubić wpis (200)",
            `Otrzymano: ${allowedLike.status}`,
          );
          const allowedComment = await clientB.postForm(
            `/posts/${restrictedPostId}/comment`,
            { content: "Legalny komentarz obserwującego" },
          );
          assert(
            allowedComment.status === 200,
            "Regresja Comment (restricted): Obserwujący UserB może skomentować wpis (200)",
            `Otrzymano: ${allowedComment.status}`,
          );
        }
        // 4. Test Rate-Limitera AI (11 zapytań pod rząd -> 429 Too Many Requests)
        const dummyPostId = "6adeff567d07c910c127ed5c";
        let got429 = false;
        for (let i = 1; i <= 11; i++) {
          const resAi = await clientB.postForm(
            `/posts/${dummyPostId}/factcheck-reader`,
            {},
          );
          if (resAi.status === 429) {
            got429 = true;
            break;
          }
        }
        assert(
          got429,
          "Rate Limiter AI: 11. żądanie w ciągu godziny zwraca 429 Too Many Requests",
        );
        // 5. Test RBAC (zwykły użytkownik próbuje wejść na /editors i /admin)
        const editorRes = await clientB.get("/editors");
        assert(
          editorRes.status === 403,
          "RBAC Editors: Zwykły użytkownik dostaje 403 na /editors",
          `Otrzymano: ${editorRes.status}`,
        );
        const adminRes = await clientB.get("/admin");
        assert(
          adminRes.status === 403,
          "RBAC Admin: Zwykły użytkownik dostaje 403 na /admin",
          `Otrzymano: ${adminRes.status}`,
        );
      }
    }
  } finally {
    // =========================================================================
    // SPRZĄTANIE: KASKADOWE USUNIĘCIE KONT TESTOWYCH I ICH POSTÓW Z BAZY
    // =========================================================================
    console.log("\n🧹 Usuwanie tymczasowych kont testowych z bazy MongoDB...");
    if (createdUserA?._id) {
      const resA = await rmUser(createdUserA._id);
      console.log(
        resA?.success
          ? `Usunięto UserA (${userAData.email})`
          : `⚠️ Błąd usuwania UserA: ${resA?.message}`,
      );
    }
    if (createdUserB?._id) {
      const resB = await rmUser(createdUserB._id);
      console.log(
        resB?.success
          ? `Usunięto UserB (${userBData.email})`
          : `⚠️ Błąd usuwania UserB: ${resB?.message}`,
      );
    }
    await mongoose.disconnect();
  }
  console.log("\n==========================================");
  console.log(`Wynik testów: ${passed} zaliczonych, ${failed} nieudanych`);
  console.log("==========================================\n");
  process.exit(failed > 0 ? 1 : 0);
}
runTests().catch(async (err) => {
  console.error("Krytyczny błąd runnera testów:", err);
  await mongoose.disconnect();
  process.exit(1);
});
