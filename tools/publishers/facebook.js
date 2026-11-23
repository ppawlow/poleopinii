const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { createLog } = require("../systemLog");
const { Post } = require("../db");

const FB_GRAPH_VERSION = "v21.0";
const fbApi = `https://graph.facebook.com/${FB_GRAPH_VERSION}/`;

function escapePango(unsafe) {
  return String(unsafe || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPostCaption(post, maxLength = 280) {
  const rawText = post.excerpt || post.lead || post.summary || post.content || "";

  const cleanText = String(rawText)
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .replace(/[#*_`>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    return post.title + "\n\n👇 Link do całego artykułu znajdziesz w pierwszym komentarzu.";
  }

  const shortened =
    cleanText.length > maxLength
      ? cleanText.slice(0, maxLength).replace(/\s+\S*$/, "") + "…"
      : cleanText;

  return post.title + "\n\n" + shortened + "\n\n👇 Cały tekst i dyskusja w linku w komentarzu.";
}

async function prepareFacebookImage(post) {
  const width = 1200;
  const height = 630;
  const safeTitle = escapePango(String(post.title || "").trim());

  let localImagePath = null;
  if (post.imageUrl) {
    const resolved = path.resolve(__dirname, "../../public", post.imageUrl.replace(/^\/+/, ""));
    const publicDir = path.resolve(__dirname, "../../public");
    if (resolved.startsWith(publicDir) && fs.existsSync(resolved)) {
      localImagePath = resolved;
    }
  }

  // WARIANT A: Post posiada własną grafikę -> zdjęcie + ciemny pasek na dole z tytułem
  if (localImagePath) {
    const pangoMarkup =
      '<span foreground="#ffffff" font_desc="Sans Bold 32">' +
      safeTitle +
      '</span>\n<span foreground="#e5a93c" font_desc="Sans Bold 22">(link w komentarzu)</span>';

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

  // WARIANT B: Brak zdjęcia w poście -> czerwona karta (#e1183c) z wyśrodkowanym tytułem
  const fontSize = safeTitle.length > 85 ? 36 : 44;
  const pangoMarkup =
    '<span foreground="#ffffff" font_desc="Sans Bold ' +
    fontSize +
    '">' +
    safeTitle +
    '\n(link w komentarzu)</span>';

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

async function publishPostToFacebook(post, req) {
  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    console.warn("[FB AUTO-SHARE] Pominięto: Brak FB_PAGE_ID lub FB_PAGE_ACCESS_TOKEN w .env");
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
    const baseUrl = req.protocol + "://" + req.get("host");
    const postUrl = baseUrl + "/posts/" + post._id;

    const imageBuffer = await prepareFacebookImage(post);
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });
    const caption = buildPostCaption(post, 280);

    const formData = new FormData();
    formData.append("source", imageBlob, "post-" + post._id + ".png");
    formData.append("caption", caption);
    formData.append("published", "true");
    formData.append("access_token", accessToken);

    const response = await fetch(fbApi + pageId + "/photos", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : response.statusText;
      console.error("[FB AUTO-SHARE ERROR]:", errorMsg);
      await createLog(
        req,
        '[FB BŁĄD] Nie udało się udostępnić posta "' + post.title + '" na Facebooku: ' + errorMsg,
        "System-SocialMedia"
      );
      return null;
    }

    const fbPostId = data.post_id || data.id;
    await Post.findByIdAndUpdate(post._id, { fbPostId });

    const commentMessage = "📖 Czytaj całość i dyskutuj na " + req.get("host") + " (Autor: " + post.author + "):\n" + postUrl;

    const commentResponse = await fetch(fbApi + fbPostId + "/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commentMessage,
        access_token: accessToken,
      }),
    });

    const commentData = await commentResponse.json();

    if (!commentResponse.ok || commentData.error) {
      const commentErr = commentData.error ? commentData.error.message : commentResponse.statusText;
      console.error("[FB AUTO-COMMENT ERROR]:", commentErr);
      await createLog(
        req,
        '[FB OSTRZEŻENIE] Opublikowano grafikę "' + post.title + '" (ID: ' + fbPostId + '), ale nie udało się dodać komentarza z linkiem: ' + commentErr,
        "System-SocialMedia"
      );
    } else {
      console.log("[FB AUTO-SHARE] Opublikowano grafikę (" + fbPostId + ") oraz komentarz z linkiem (" + commentData.id + ").");
      await createLog(
        req,
        '[FB AUTO-SHARE] Opublikowano grafikę "' + post.title + '" na fanpage\'u (ID: ' + fbPostId + ') wraz z linkiem w komentarzu.',
        "System-SocialMedia"
      );
    }

    return fbPostId;
  } catch (err) {
    console.error("[FB AUTO-SHARE CRITICAL]:", err);
    await createLog(
      req,
      '[FB BŁĄD KRYTYCZNY] Awaria połączenia z Meta Graph API dla posta "' + post.title + '": ' + err.message,
      "System-SocialMedia"
    );
    return null;
  }
}

async function deletePostFromFacebook(post, req) {
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!accessToken || !post || !post.fbPostId) {
    return false;
  }

  const fbId = post.fbPostId;

  try {
    const response = await fetch(
      fbApi + fbId + "?access_token=" + encodeURIComponent(accessToken),
      { method: "DELETE" }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : response.statusText;
      console.error("[FB AUTO-DELETE ERROR]:", errorMsg);
      await createLog(
        req,
        '[FB BŁĄD USUWANIA] Nie udało się usunąć posta "' + post.title + '" (FB ID: ' + fbId + ') z Facebooka: ' + errorMsg,
        "System-SocialMedia"
      );
      return false;
    }

    await Post.findByIdAndUpdate(post._id, { fbPostId: null });

    console.log("[FB AUTO-DELETE] Usunięto post z fanpage'a. FB Post ID: " + fbId);
    await createLog(
      req,
      '[FB AUTO-DELETE] Usunięto post "' + post.title + '" (ID: ' + fbId + ') z fanpage\'a po wycofaniu ze sfery publicznej.',
      "System-SocialMedia"
    );

    return true;
  } catch (err) {
    console.error("[FB AUTO-DELETE CRITICAL]:", err);
    await createLog(
      req,
      "[FB BŁĄD KRYTYCZNY] Awaria podczas usuwania posta z FB (ID: " + fbId + "): " + err.message,
      "System-SocialMedia"
    );
    return false;
  }
}

module.exports = { publishPostToFacebook, deletePostFromFacebook };
