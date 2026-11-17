// tools/fediversePublisher.js
const { createLog } = require("../systemLog");
const { SERVICE_NAME } = require("../../config");
const { generatePostExcerpt } = require("../excerptHelper");
const { Post } = require("../db");

/**
 * Publikuje post publiczny w Fediversum (Mastodon REST API v1).
 */
async function publishPostToFediverse(post, req) {
  const instanceUrl = (process.env.MASTODON_INSTANCE_URL || "").replace(/\/+$/, "");
  const accessToken = process.env.MASTODON_ACCESS_TOKEN;

  if (!instanceUrl || !accessToken) {
    console.warn("[FEDIVERSE] Pominięto: Brak MASTODON_INSTANCE_URL lub MASTODON_ACCESS_TOKEN w .env");
    return null;
  }

  if (
    !post ||
    post.fediPostId ||
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

    const formattedTitle = (post.title || "").toUpperCase();
    // Mastodon ma limit 500 znaków na cały status, więc zajawka ~220 znaków mieści się bezpiecznie
    const excerpt = generatePostExcerpt(post.content, 200);

    const statusText = [
      `📰 ${formattedTitle}`,
      `✍️ Autor: ${post.author} (${authorProfileUrl})`,
      excerpt ? `\n„${excerpt}”` : "",
      `\n👉 Czytaj całość: ${postUrl}`,
      `\n#PoleOpinii #Publicystyka #Opinie`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 495); // Twarde zabezpieczenie przed przekroczeniem limitu 500 znaków

    const response = await fetch(`${instanceUrl}/api/v1/statuses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // Idempotency-Key gwarantuje, że ewentualny retry sieciowy nie zdubluje wpisu
        "Idempotency-Key": `post-${post._id}`,
      },
      body: JSON.stringify({
        status: statusText,
        visibility: "public",
        language: "pl",
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error || response.statusText;
      console.error("[FEDIVERSE ERROR]:", errorMsg);
      await createLog(
        req,
        `[FEDIVERSE BŁĄD] Nie udało się opublikować posta "${post.title}": ${errorMsg}`,
        "System-SocialMedia"
      );
      return null;
    }

    await Post.findByIdAndUpdate(post._id, { fediPostId: data.id });

    console.log(`[FEDIVERSE] Opublikowano post. ID: ${data.id}`);
    await createLog(
      req,
      `[FEDIVERSE] Automatycznie udostępniono post publiczny "${post.title}" w Fediversum (ID: ${data.id}).`,
      "System-SocialMedia"
    );

    return data.id;
  } catch (err) {
    console.error("[FEDIVERSE CRITICAL]:", err);
    await createLog(
      req,
      `[FEDIVERSE BŁĄD KRYTYCZNY] Awaria połączenia dla posta "${post.title}": ${err.message}`,
      "System-SocialMedia"
    );
    return null;
  }
}

/**
 * Usuwa post z Fediversum po wycofaniu wpisu do szkicu lub jego usunięciu.
 */
async function deletePostFromFediverse(post, req) {
  const instanceUrl = (process.env.MASTODON_INSTANCE_URL || "").replace(/\/+$/, "");
  const accessToken = process.env.MASTODON_ACCESS_TOKEN;

  if (!instanceUrl || !accessToken || !post || !post.fediPostId) {
    return false;
  }

  const fediId = post.fediPostId;

  try {
    const response = await fetch(`${instanceUrl}/api/v1/statuses/${fediId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error("[FEDIVERSE DELETE ERROR]:", response.statusText);
      return false;
    }

    await Post.findByIdAndUpdate(post._id, { fediPostId: null });
    await createLog(
      req,
      `[FEDIVERSE DELETE] Usunięto post "${post.title}" (ID: ${fediId}) z Fediversum po wycofaniu ze sfery publicznej.`,
      "System-SocialMedia"
    );

    return true;
  } catch (err) {
    console.error("[FEDIVERSE DELETE CRITICAL]:", err);
    return false;
  }
}

module.exports = { publishPostToFediverse, deletePostFromFediverse };
