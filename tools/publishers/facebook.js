// tools/publishers/facebook.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { createLog } = require("../systemLog");
const { Post } = require("../db");

const FB_GRAPH_VERSION = "v21.0";
const fbApi = `https://graph.facebook.com/${FB_GRAPH_VERSION}/`;

/**
 * Escapuje znaki specjalne XML dla bezpiecznego osadzenia tekstu w SVG
 */
function escapeXml(unsafe) {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Dzieli tytuł na linie o zadanej maksymalnej liczbie znaków (bez ucinania słów)
 */
function wrapTitleLines(title, maxCharsPerLine = 28, maxLines = 4) {
  const words = String(title || "")
    .trim()
    .split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + " " + word).length <= maxCharsPerLine) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length === maxLines - 1) break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  const usedWordsCount = lines.join(" ").split(/\s+/).length;
  if (usedWordsCount < words.length && lines.length > 0) {
    lines[lines.length - 1] =
      lines[lines.length - 1].replace(/[.…,;:!?]+$/, "") + "…";
  }

  return lines;
}

/**
 * Tworzy bezpieczną zajawkę posta (bez HTML, Markdown i bez linków) do pola `caption` na Facebooku
 */
function buildPostCaption(post, maxLength = 280) {
  const rawText =
    post.excerpt || post.lead || post.summary || post.content || "";

  const cleanText = String(rawText)
    .replace(/<[^>]*>/g, " ") // usunięcie tagów HTML
    .replace(/https?:\/\/[^\s)]+/gi, "") // usunięcie ewentualnych linków z treści
    .replace(/[#*_`>~]+/g, "") // usunięcie podstawowego formatowania Markdown
    .replace(/\s+/g, " ") // redukcja wielokrotnych spacji i enterów
    .trim();

  if (!cleanText) {
    return `${post.title}\n\n👇 Link do całego artykułu znajdziesz w pierwszym komentarzu.`;
  }

  const shortened =
    cleanText.length > maxLength
      ? cleanText.slice(0, maxLength).replace(/\s+\S*$/, "") + "…"
      : cleanText;

  return `${post.title}\n\n${shortened}\n\n👇 Cały tekst i dyskusja w linku w komentarzu.`;
}

/**
 * Przygotowuje obraz PNG (1200x630) do publikacji na Facebooku:
 * - Jeśli post posiada zdjęcie (`post.imageUrl`), kadruje je i nakłada na dole belkę z tytułem.
 * - Jeśli post nie ma zdjęcia (lub pliku nie ma na dysku), generuje czerwoną kartę z tytułem.
 */
async function prepareFacebookImage(post) {
  const width = 1200;
  const height = 630;

  let localImagePath = null;
  if (post.imageUrl) {
    const resolved = path.resolve(
      __dirname,
      "../../public",
      post.imageUrl.replace(/^\/+/, ""),
    );
    const publicDir = path.resolve(__dirname, "../../public");
    if (resolved.startsWith(publicDir) && fs.existsSync(resolved)) {
      localImagePath = resolved;
    }
  }

  // WARIANT A: Post posiada własną grafikę -> zdjęcie w tle + ciemny gradient u dołu z tytułem
  if (localImagePath) {
    const lines = wrapTitleLines(post.title, 36, 3);
    lines.push("(link w komentarzu)");

    const fontSize = 42;
    const lineHeight = 52;
    const blockHeight = lines.length * lineHeight + 50;
    const startY = height - blockHeight + 48;

    const tspans = lines
      .map((line, idx) => {
        const y = startY + idx * lineHeight;
        const isHint = idx === lines.length - 1;
        return `<tspan x="60" y="${y}" font-size="${isHint ? 30 : fontSize}px" fill="${isHint ? "#e5a93c" : "#ffffff"}">${escapeXml(line)}</tspan>`;
      })
      .join("");

    const overlaySvg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://w3.org">
        <defs>
          <linearGradient id="bottomGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0" />
            <stop offset="45%" stop-color="#000000" stop-opacity="0.72" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.92" />
          </linearGradient>
        </defs>
        <rect x="0" y="${height - blockHeight - 80}" width="${width}" height="${blockHeight + 80}" fill="url(#bottomGrad)" />
        <text
          font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif"
          font-weight="700"
          text-anchor="start"
        >
          ${tspans}
        </text>
      </svg>
    `;

    return await sharp(localImagePath)
      .resize(width, height, { fit: "cover", position: "attention" })
      .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
      .png()
      .toBuffer();
  }

  // WARIANT B: Brak zdjęcia w poście -> czerwona karta typograficzna z tytułem na środku
  const lines = wrapTitleLines(post.title, 28, 4);
  lines.push("(link w komentarzu)");

  const fontSize = lines.length <= 3 ? 56 : 48;
  const lineHeight = Math.round(fontSize * 1.28);
  const totalTextHeight = (lines.length - 1) * lineHeight;
  const startY = Math.round(height / 2 - totalTextHeight / 2 + fontSize * 0.35);

  const tspans = lines
    .map((line, idx) => {
      const y = startY + idx * lineHeight;
      return `<tspan x="${width / 2}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const fallbackSvg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://w3.org">
      <rect width="100%" height="100%" fill="#e1183c" />
      <text
        fill="#ffffff"
        font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif"
        font-size="${fontSize}px"
        font-weight="700"
        text-anchor="middle"
      >
        ${tspans}
      </text>
    </svg>
  `;

  return await sharp(Buffer.from(fallbackSvg)).png().toBuffer();
}

/**
 * Publikuje grafikę (ze zdjęcia posta lub wygenerowaną kartę tytułu) wraz z zajawką na fanpage'u,
 * a właściwy link do artykułu umieszcza w pierwszym komentarzu.
 */
async function publishPostToFacebook(post, req) {
  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    console.warn(
      "[FB AUTO-SHARE] Pominięto: Brak FB_PAGE_ID lub FB_PAGE_ACCESS_TOKEN w .env",
    );
    return null;
  }

  if (
    !post ||
    post.fbPostId ||
    post.visibility !== "public" ||
    post.isAbuseReport ||
    post.isFactCheckReport
  ) {
    return null;
  }

  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const postUrl = `${baseUrl}/posts/${post._id}`;

    // 1. Przygotowanie obrazu oraz tekstu zajawki (bez linków)
    const imageBuffer = await prepareFacebookImage(post);
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });
    const caption = buildPostCaption(post, 280);

    const formData = new FormData();
    formData.append("source", imageBlob, `post-${post._id}.png`);
    formData.append("caption", caption);
    formData.append("published", "true");
    formData.append("access_token", accessToken);

    // 2. Publikacja zdjęcia na fanpage'u (bez linku w treści posta)
    const response = await fetch(fbApi + `${pageId}/photos`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : response.statusText;
      console.error("[FB AUTO-SHARE ERROR]:", errorMsg);
      await createLog(
        req,
        `[FB BŁĄD] Nie udało się udostępnić posta "${post.title}" na Facebooku: ${errorMsg}`,
        "System-SocialMedia",
      );
      return null;
    }

    const fbPostId = data.post_id || data.id;
    await Post.findByIdAndUpdate(post._id, { fbPostId });

    // 3. Dodanie pierwszego komentarza z linkiem do artykułu
    const commentMessage = `📖 Czytaj całość i dyskutuj na ${req.get("host")} (Autor: ${post.author}):\n${postUrl}`;

    const commentResponse = await fetch(fbApi + `${fbPostId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commentMessage,
        access_token: accessToken,
      }),
    });

    const commentData = await commentResponse.json();

    if (!commentResponse.ok || commentData.error) {
      const commentErr = commentData.error
        ? commentData.error.message
        : commentResponse.statusText;
      console.error("[FB AUTO-COMMENT ERROR]:", commentErr);
      await createLog(
        req,
        `[FB OSTRZEŻENIE] Opublikowano grafikę "${post.title}" (ID: ${fbPostId}), ale nie udało się dodać komentarza z linkiem: ${commentErr}`,
        "System-SocialMedia",
      );
    } else {
      console.log(
        `[FB AUTO-SHARE] Opublikowano grafikę (${fbPostId}) oraz komentarz z linkiem (${commentData.id}).`,
      );
      await createLog(
        req,
        `[FB AUTO-SHARE] Opublikowano grafikę "${post.title}" na fanpage'u (ID: ${fbPostId}) wraz z linkiem w komentarzu.`,
        "System-SocialMedia",
      );
    }

    return fbPostId;
  } catch (err) {
    console.error("[FB AUTO-SHARE CRITICAL]:", err);
    await createLog(
      req,
      `[FB BŁĄD KRYTYCZNY] Awaria połączenia z Meta Graph API dla posta "${post.title}": ${err.message}`,
      "System-SocialMedia",
    );
    return null;
  }
}

/**
 * Usuwa opublikowany wcześniej post (wraz z komentarzem) z fanpage'a Facebooka.
 */
async function deletePostFromFacebook(post, req) {
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!accessToken || !post || !post.fbPostId) {
    return false;
  }

  const fbId = post.fbPostId;

  try {
    const response = await fetch(
      fbApi + `${fbId}?access_token=${encodeURIComponent(accessToken)}`,
      { method: "DELETE" },
    );

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : response.statusText;
      console.error("[FB AUTO-DELETE ERROR]:", errorMsg);
      await createLog(
        req,
        `[FB BŁĄD USUWANIA] Nie udało się usunąć posta "${post.title}" (FB ID: ${fbId}) z Facebooka: ${errorMsg}`,
        "System-SocialMedia",
      );
      return false;
    }
    await Post.findByIdAndUpdate(post._id, { fbPostId: null });
    console.log(
      `[FB AUTO-DELETE] Usunięto post z fanpage'a. FB Post ID: ${fbId}`,
    );
    await createLog(
      req,
      `[FB AUTO-DELETE] Usunięto post "${post.title}" (ID: ${fbId}) z fanpage'a po wycofaniu ze sfery publicznej.`,
      "System-SocialMedia",
    );
    return true;
  } catch (err) {
    console.error("[FB AUTO-DELETE CRITICAL]:", err);
    await createLog(
      req,
      `[FB BŁĄD KRYTYCZNY] Awaria podczas usuwania posta z FB (ID: ${fbId}): ${err.message}`,
      "System-SocialMedia",
    );
    return false;
  }
}
module.exports = { publishPostToFacebook, deletePostFromFacebook };
