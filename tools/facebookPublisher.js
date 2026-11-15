// tools/facebookPublisher.js
const { createLog } = require("./systemLog");
const { SERVICE_NAME } = require("../config");
const { generatePostExcerpt } = require("./excerptHelper");
const { Post } = require("./db");

const FB_GRAPH_VERSION = "v21.0";
const MAX_EXCERPT_LENGTH = 220;
const fbApi = `https://graph.facebook.com/${FB_GRAPH_VERSION}/`;

/**
 * Publikuje post publiczny na fanpage'u Facebooka za pomocą Graph API.
 */
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
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const postUrl = `${baseUrl}/posts/${post._id}`;
    const profilePath = req.dbUser?.profileUrl || `/profile/${post.authorId}`;
    const authorProfileUrl = `${baseUrl}${profilePath}`;

    const excerpt = generatePostExcerpt(post.content, MAX_EXCERPT_LENGTH);

    const fbMessage = [
      // `📰 ${post.title}`,
      excerpt ? `\n${excerpt}` : "",
      `\nCzytaj całość i dyskutuj na ${SERVICE_NAME}:`,
      `(Autor: ${post.author}, ${authorProfileUrl})\n`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch(fbApi + `${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: fbMessage,
        link: postUrl,
        access_token: accessToken,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : response.statusText;
      console.error("[FB AUTO-SHARE ERROR]:", errorMsg);
      await createLog(
        req,
        `[FB BŁĄD] Nie udało się udostępnić posta "${post.title}" na Facebooku: ${errorMsg}`,
        "System-SocialMedia"
      );
      return null;
    }

    await Post.findByIdAndUpdate(post._id, { fbPostId: data.id });

    console.log(`[FB AUTO-SHARE] Opublikowano post na fanpage'u. FB Post ID: ${data.id}`);
    await createLog(
      req,
      `[FB AUTO-SHARE] Automatycznie udostępniono post publiczny "${post.title}" na fanpage'u (ID: ${data.id}).`,
      "System-SocialMedia"
    );

    return data.id;
  } catch (err) {
    console.error("[FB AUTO-SHARE CRITICAL]:", err);
    await createLog(
      req,
      `[FB BŁĄD KRYTYCZNY] Awaria połączenia z Meta Graph API dla posta "${post.title}": ${err.message}`,
      "System-SocialMedia"
    );
    return null;
  }
}

/**
 * Usuwa opublikowany wcześniej post z fanpage'a Facebooka.
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
      { method: "DELETE" }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : response.statusText;
      console.error("[FB AUTO-DELETE ERROR]:", errorMsg);
      await createLog(
        req,
        `[FB BŁĄD USUWANIA] Nie udało się usunąć posta "${post.title}" (FB ID: ${fbId}) z Facebooka: ${errorMsg}`,
        "System-SocialMedia"
      );
      return false;
    }

    await Post.findByIdAndUpdate(post._id, { fbPostId: null });

    console.log(`[FB AUTO-DELETE] Usunięto post z fanpage'a. FB Post ID: ${fbId}`);
    await createLog(
      req,
      `[FB AUTO-DELETE] Usunięto post "${post.title}" (ID: ${fbId}) z fanpage'a po wycofaniu ze sfery publicznej.`,
      "System-SocialMedia"
    );

    return true;
  } catch (err) {
    console.error("[FB AUTO-DELETE CRITICAL]:", err);
    await createLog(
      req,
      `[FB BŁĄD KRYTYCZNY] Awaria podczas usuwania posta z FB (ID: ${fbId}): ${err.message}`,
      "System-SocialMedia"
    );
    return false;
  }
}

module.exports = { publishPostToFacebook, deletePostFromFacebook };
