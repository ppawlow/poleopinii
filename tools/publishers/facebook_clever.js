// tools/publishers/facebook.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { createLog } = require("../systemLog");
const { Post } = require("../db");

const FB_GRAPH_VERSION = "v21.0";
const fbApi = `https://facebook.com{FB_GRAPH_VERSION}/`;
const DELAY_MINUTES = 45; // Czas oczekiwania przed wstrzyknięciem linku w treść posta

function escapePango(unsafe) {
  return String(unsafe || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Buduje treść zajawki posta:
 * - includeLink = false (Etap 1: pierwsze 45 min bez URL-a dla pełnego zasięgu)
 * - includeLink = true  (Etap 2: aktualizacja posta z klikalnym linkiem do udostępniania dalej)
 */
function buildPostCaption(
  post,
  { includeLink = false, postUrl = "" } = {},
  maxLength = 280,
) {
  const rawText =
    post.excerpt || post.lead || post.summary || post.content || "";

  const cleanText = String(rawText)
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .replace(/[#*_`>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const shortened =
    cleanText.length > maxLength
      ? cleanText.slice(0, maxLength).replace(/\s+\S*$/, "") + "…"
      : cleanText;

  const bodyPart = shortened
    ? `${post.title}\n\n${shortened}`
    : `${post.title}`;

  if (includeLink && postUrl) {
    return `${bodyPart}\n\n📖 Czytaj cały artykuł i dołącz do dyskusji:\n${postUrl}`;
  }

  return `${bodyPart}\n\n👇 Link do całego artykułu w komentarzu pod oryginalnym wpisem (poleopinii.pl).`;
}

/**
 * Przygotowuje grafikę 1200x630 z tytułem oraz czytelnym oznaczeniem domeny poleopinii.pl
 */
async function prepareFacebookImage(post) {
  const width = 1200;
  const height = 630;
  const safeTitle = escapePango(String(post.title || "").trim());

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

  // WARIANT A: Post posiada własną grafikę -> zdjęcie + ciemny pasek z tytułem i domeną
  if (localImagePath) {
    const pangoMarkup =
      '<span foreground="#ffffff" font_desc="Sans Bold 32">' +
      safeTitle +
      '</span>\n<span foreground="#e5a93c" font_desc="Sans Bold 21">poleopinii.pl  •  link w komentarzu</span>';

    const textLayer = await sharp({
      text: {
        text: pangoMarkup,
        width: width - 120,
        align: "left",
        rgba: true,
      },
    })
      .png()
      .toBuffer();

    const textMeta = await sharp(textLayer).metadata();
    const bannerHeight = Math.min(height - 40, (textMeta.height || 120) + 56);

    const darkBanner = await sharp({
      create: {
        width: width,
        height: bannerHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.78 },
      },
    })
      .png()
      .toBuffer();

    return await sharp(localImagePath)
      .resize(width, height, { fit: "cover", position: "attention" })
      .composite([
        { input: darkBanner, top: height - bannerHeight, left: 0 },
        { input: textLayer, top: height - bannerHeight + 28, left: 60 },
      ])
      .png()
      .toBuffer();
  }

  // WARIANT B: Brak zdjęcia w poście -> czerwona karta (#e1183c) z wyśrodkowanym tytułem i stopką domeny
  const fontSize = safeTitle.length > 85 ? 36 : 44;
  const pangoMarkup =
    '<span foreground="#ffffff" font_desc="Sans Bold ' +
    fontSize +
    '">' +
    safeTitle +
    '</span>\n\n<span foreground="#ffe69c" font_desc="Sans Bold 22">poleopinii.pl  •  link w komentarzu</span>';

  const textLayer = await sharp({
    text: {
      text: pangoMarkup,
      width: width - 160,
      align: "centre",
      rgba: true,
    },
  })
    .png()
    .toBuffer();

  return await sharp({
    create: {
      width: width,
      height: height,
      channels: 4,
      background: { r: 225, g: 24, b: 60, alpha: 1 },
    },
  })
    .composite([{ input: textLayer, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * ETAP 1: Publikuje grafikę + zajawkę bez linku oraz dodaje pierwszy komentarz z odnośnikiem
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

    const imageBuffer = await prepareFacebookImage(post);
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });
    const caption = buildPostCaption(post, { includeLink: false }, 280);

    const formData = new FormData();
    formData.append("source", imageBlob, `post-${post._id}.png`);
    formData.append("caption", caption);
    formData.append("published", "true");
    formData.append("access_token", accessToken);

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
    await Post.findByIdAndUpdate(post._id, {
      fbPostId,
      fbLinkInjected: false,
      fbBaseUrl: baseUrl,
    });

    // Dodanie pierwszego komentarza z linkiem (dla osób wchodzących w pierwszej godzinie)
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
        `[FB AUTO-SHARE] Etap 1 OK: grafika (${fbPostId}) + komentarz (${commentData.id}). Link zostanie dopisany do posta za ${DELAY_MINUTES} min.`,
      );
      await createLog(
        req,
        `[FB AUTO-SHARE] Opublikowano grafikę "${post.title}" (ID: ${fbPostId}) z linkiem w komentarzu (edycja posta z linkiem za ${DELAY_MINUTES} min).`,
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
 * ETAP 2 (CRON): Po upływie DELAY_MINUTES dopisuje klikalny link do opisu opublikowanego już posta,
 * zachowując dużą grafikę 1200x630 oraz sprawiając, że dalsze udostępnienia (Share) zawierają link.
 */
async function injectDelayedFacebookLinks() {
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!accessToken) return;

  const cutoffDate = new Date(Date.now() - DELAY_MINUTES * 60 * 1000);

  try {
    const pendingPosts = await Post.find({
      fbPostId: { $ne: null },
      fbLinkInjected: { $ne: true },
      visibility: "public",
      createdAt: { $lte: cutoffDate },
    }).limit(10);

    for (const post of pendingPosts) {
      const baseUrl =
        post.fbBaseUrl || process.env.APP_URL || "https://poleopinii.pl";
      const postUrl = `${baseUrl.replace(/\/+$/, "")}/posts/${post._id}`;
      const updatedMessage = buildPostCaption(
        post,
        { includeLink: true, postUrl },
        280,
      );

      const response = await fetch(fbApi + `${post.fbPostId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: updatedMessage,
          access_token: accessToken,
        }),
      });

      const data = await response.json();

      if (response.ok && !data.error) {
        await Post.findByIdAndUpdate(post._id, { fbLinkInjected: true });
        console.log(
          `[FB DELAYED LINK] Dopisano link bezpośrednio do posta FB (${post.fbPostId}): "${post.title}"`,
        );
        await createLog(
          { ip: "127.0.0.1" },
          `[FB DELAYED LINK] Dopisano klikalny link do treści posta "${post.title}" (ID: ${post.fbPostId}) po ${DELAY_MINUTES} min.`,
          "System-SocialMedia",
        );
      } else {
        const errMsg = data.error ? data.error.message : response.statusText;
        console.error(`[FB DELAYED LINK ERROR] (${post.fbPostId}):`, errMsg);
        // Oznaczamy jako obsłużone przy trwałym błędzie obiektu (np. usunięty ręcznie na FB), aby nie zapętlać
        if (data.error?.code === 100 || data.error?.code === 803) {
          await Post.findByIdAndUpdate(post._id, { fbLinkInjected: true });
        }
      }
    }
  } catch (err) {
    console.error("[FB DELAYED LINK CRITICAL]:", err.message);
  }
}

/**
• Usuwa opublikowany wcześniej post z fanpage'a Facebooka
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
    const data = await response.json();
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
    await Post.findByIdAndUpdate(post._id, {
      fbPostId: null,
      fbLinkInjected: false,
      fbBaseUrl: null,
    });
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
module.exports = {
  publishPostToFacebook,
  deletePostFromFacebook,
  injectDelayedFacebookLinks,
};
