// tools/blueskyPublisher.js
const fs = require("fs");
const path = require("path");
const { createLog } = require("./systemLog");
const { SERVICE_NAME } = require("../config");
const { generatePostExcerpt } = require("./excerptHelper");
const { Post } = require("./db");

const BSKY_API = "https://bsky.social";
const MAX_BSKY_LENGTH = 300; // Limit Bluesky wynosi 300 znaków

/**
 * Tworzy sesję w AT Protocol i zwraca accessJwt oraz did konta.
 */
async function createBlueskySession() {
  const identifier = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!identifier || !password) return null;

  const res = await fetch(`${BSKY_API}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });

  const data = await res.json();
  if (!res.ok || !data.accessJwt) {
    throw new Error(data.message || "Nie udało się utworzyć sesji Bluesky.");
  }
  return data;
}

/**
 * Wgrywa lokalny obrazek wyróżniający artykułu jako blob do Bluesky (max 1MB).
 */
async function uploadImageBlob(accessJwt, imageUrl) {
  if (!imageUrl) return null;
  try {
    const localPath = path.join(__dirname, "../public", imageUrl);
    if (!fs.existsSync(localPath)) return null;

    const stats = fs.statSync(localPath);
    if (stats.size > 950 * 1024) return null; // Limit bloba w Bluesky to ~1MB

    const ext = path.extname(localPath).toLowerCase();
    const mimeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    const contentType = mimeMap[ext];
    if (!contentType) return null;

    const fileBuffer = fs.readFileSync(localPath);
    const res = await fetch(`${BSKY_API}/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
      },
      body: fileBuffer,
    });

    const data = await res.json();
    return res.ok && data.blob ? data.blob : null;
  } catch (err) {
    console.warn("[BLUESKY BLOB WARN]: Nie udało się wgrać miniatury:", err.message);
    return null;
  }
}

/**
 * Publikuje post publiczny na Bluesky z podlinkowanym imieniem i nazwiskiem autora oraz kartą artykułu.
 */
async function publishPostToBluesky(post, req) {
  if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_APP_PASSWORD) {
    console.warn("[BLUESKY] Pominięto: Brak BLUESKY_HANDLE lub BLUESKY_APP_PASSWORD w .env");
    return null;
  }

  if (
    !post ||
    post.bskyPostUri ||
    post.visibility !== "public" ||
    post.isAbuseReport ||
    post.isFactCheckReport
  ) {
    return null;
  }

  try {
    const session = await createBlueskySession();
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const postUrl = `${baseUrl}/posts/${post._id}`;
    const profilePath = req.dbUser?.profileUrl || `/profile/${post.authorId}`;
    const authorProfileUrl = `${baseUrl}${profilePath}`;

    const formattedTitle = (post.title || "").toUpperCase();
    const authorName = (post.author || "Autor").trim();
    const excerpt = generatePostExcerpt(post.content, 160);

    // Zwięzły, estetyczny tekst bez surowych adresów URL (linki są podpięte pod nazwisko i kartę)
    const authorLine = `✍️ Autor: ${authorName}`;
    const tagsLine = `\n\n#PoleOpinii #Publicystyka #Opinie`;

    let fullText = `📰 ${formattedTitle}\n${authorLine}${tagsLine}`;
    if (fullText.length > MAX_BSKY_LENGTH) {
      const allowedTitleLen = Math.max(
        20,
        MAX_BSKY_LENGTH - (`📰 …\n${authorLine}${tagsLine}`).length
      );
      fullText = `📰 ${formattedTitle.slice(0, allowedTitleLen).trim()}…\n${authorLine}${tagsLine}`;
    }

    // Obliczanie pozycji bajtowych UTF-8 dokładnie dla samego imienia i nazwiska autora
    const encoder = new TextEncoder();
    const authorIndex = fullText.indexOf(authorName, fullText.indexOf("✍️ Autor: "));
    const byteStart = encoder.encode(fullText.slice(0, authorIndex)).length;
    const byteEnd = byteStart + encoder.encode(authorName).length;

    const facets = [
      {
        index: { byteStart, byteEnd },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: authorProfileUrl }],
      },
    ];

    // Wykrywanie i podlinkowanie hashtagów w facets
    const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
    let match;
    while ((match = hashtagRegex.exec(fullText)) !== null) {
      const tagStart = encoder.encode(fullText.slice(0, match.index)).length;
      const tagEnd = tagStart + encoder.encode(match[0]).length;
      facets.push({
        index: { byteStart: tagStart, byteEnd: tagEnd },
        features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[0].slice(1) }],
      });
    }

    // Wgranie miniatury posta (jeśli istnieje) i budowa bogatej karty artykułu
    const thumbBlob = await uploadImageBlob(session.accessJwt, post.imageUrl);
    const externalEmbed = {
      $type: "app.bsky.embed.external",
      external: {
        uri: postUrl,
        title: post.title || SERVICE_NAME,
        description: excerpt || `Przeczytaj artykuł w serwisie ${SERVICE_NAME}`,
        ...(thumbBlob ? { thumb: thumbBlob } : {}),
      },
    };

    const record = {
      $type: "app.bsky.feed.post",
      text: fullText,
      facets,
      embed: externalEmbed,
      langs: ["pl"],
      createdAt: new Date().toISOString(),
    };

    const response = await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.uri) {
      const errorMsg = data.message || response.statusText;
      console.error("[BLUESKY ERROR]:", errorMsg);
      await createLog(
        req,
        `[BLUESKY BŁĄD] Nie udało się opublikować posta "${post.title}": ${errorMsg}`,
        "System-SocialMedia"
      );
      return null;
    }

    await Post.findByIdAndUpdate(post._id, { bskyPostUri: data.uri });

    console.log(`[BLUESKY] Opublikowano post. URI: ${data.uri}`);
    await createLog(
      req,
      `[BLUESKY] Automatycznie udostępniono post publiczny "${post.title}" na Bluesky.`,
      "System-SocialMedia"
    );

    return data.uri;
  } catch (err) {
    console.error("[BLUESKY CRITICAL]:", err);
    await createLog(
      req,
      `[BLUESKY BŁĄD KRYTYCZNY] Awaria połączenia dla posta "${post.title}": ${err.message}`,
      "System-SocialMedia"
    );
    return null;
  }
}

/**
 * Usuwa post z Bluesky po wycofaniu wpisu do szkicu lub jego usunięciu.
 */
async function deletePostFromBluesky(post, req) {
  if (!post || !post.bskyPostUri) return false;

  try {
    const session = await createBlueskySession();
    if (!session) return false;

    const rkey = post.bskyPostUri.split("/").pop();

    const response = await fetch(`${BSKY_API}/com.atproto.repo.deleteRecord`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        rkey,
      }),
    });

    if (!response.ok) return false;

    await Post.findByIdAndUpdate(post._id, { bskyPostUri: null });
    await createLog(
      req,
      `[BLUESKY DELETE] Usunięto post "${post.title}" z Bluesky po wycofaniu ze sfery publicznej.`,
      "System-SocialMedia"
    );

    return true;
  } catch (err) {
    console.error("[BLUESKY DELETE CRITICAL]:", err);
    return false;
  }
}

module.exports = { publishPostToBluesky, deletePostFromBluesky };
