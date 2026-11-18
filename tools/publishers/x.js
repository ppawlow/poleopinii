// tools/xPublisher.js
const crypto = require("crypto");
const { createLog } = require("../systemLog");
const { generatePostExcerpt } = require("../excerptHelper");
const { Post } = require("../db");

const X_API_TWEETS = "https://api.x.com/2/tweets";
const MAX_TWEET_LENGTH = 280;
const X_TCO_URL_LENGTH = 23; // X zawsze liczy każdy poprawny URL jako 23 znaki

/**
 * Kodowanie zgodne ze standardem RFC 3986 wymaganym przez OAuth 1.0a
 */
function percentEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Generuje nagłówek Authorization dla OAuth 1.0a User Context (HMAC-SHA1)
 */
function buildOAuth1Header(method, url) {
  const consumerKey = process.env.X_API_KEY;
  const consumerSecret = process.env.X_API_SECRET;
  const token = process.env.X_ACCESS_TOKEN;
  const tokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: "1.0",
  };

  const sortedParams = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join("&");

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  oauthParams.oauth_signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerString}`;
}

/**
 * Oblicza przybliżoną długość tweeta zgodnie z zasadami platformy X.
 * URL (http/https) liczy się jako 23 znaki, a znaki spoza BMP (np. emoji w treści posta) jako 2 znaki.
 */
function getXTweetLength(text) {
  const urlRegex = /https?:\/\/[^\s)]+/g;
  const textWithShortUrls = text.replace(urlRegex, "X".repeat(X_TCO_URL_LENGTH));

  let length = 0;
  for (const char of textWithShortUrls) {
    length += char.codePointAt(0) > 0xffff ? 2 : 1;
  }
  return length;
}

/**
 * Publikuje post publiczny na platformie X (Twitter API v2).
 * Format: wyłącznie zajawka + kompletny link do artykułu.
 */
async function publishPostToX(post, req) {
  if (
    !process.env.X_API_KEY ||
    !process.env.X_API_SECRET ||
    !process.env.X_ACCESS_TOKEN ||
    !process.env.X_ACCESS_TOKEN_SECRET
  ) {
    console.warn("[X AUTO-SHARE] Pominięto: Brak kompletu kluczy X_API_* w .env");
    return null;
  }

  if (
    !post ||
    post.xPostId ||
    post.visibility !== "public" ||
    post.isAbuseReport ||
    post.isFactCheckReport
  ) {
    return null;
  }

  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const postUrl = `${baseUrl}/posts/${post._id}`;

    // Zostawiamy 3 znaki bufora na wypadek nietypowych znaków Unicode w treści artykułu
    const SAFE_MAX_LENGTH = MAX_TWEET_LENGTH - 3;

    const buildTweet = (excerptText) =>
      excerptText ? `${excerptText}\n\n${postUrl}` : postUrl;

    // Obliczamy budżet znaków dostępny dla samej zajawki (po odjęciu linku i \n\n)
    const emptyTweetLen = getXTweetLength(buildTweet(""));
    let currentBudget = Math.max(0, SAFE_MAX_LENGTH - emptyTweetLen);

    let excerpt = generatePostExcerpt(post.content, currentBudget);

    // Bezpiecznik: jeśli w zajawce były emoji ważące 2 znaki w X, zmniejszamy budżet i ponownie tniemy do pełnego słowa
    while (
      excerpt.length > 0 &&
      getXTweetLength(buildTweet(excerpt)) > SAFE_MAX_LENGTH
    ) {
      currentBudget = Math.max(0, currentBudget - 2);
      excerpt = truncateToWord(excerpt, currentBudget);
    }

    const tweetText = buildTweet(excerpt);

    const authHeader = buildOAuth1Header("POST", X_API_TWEETS);

    const response = await fetch(X_API_TWEETS, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: tweetText }),
    });

    const data = await response.json();

    if (!response.ok || !data.data?.id) {
      const errorMsg = data.detail || data.title || response.statusText;
      console.error("[X AUTO-SHARE ERROR]:", errorMsg);
      await createLog(
        req,
        `[X BŁĄD] Nie udało się opublikować posta "${post.title}" na X: ${errorMsg}`,
        "System-SocialMedia"
      );
      return null;
    }

    const tweetId = data.data.id;
    await Post.findByIdAndUpdate(post._id, { xPostId: tweetId });

    console.log(`[X AUTO-SHARE] Opublikowano post na X. Tweet ID: ${tweetId}`);
    await createLog(
      req,
      `[X AUTO-SHARE] Automatycznie udostępniono post publiczny "${post.title}" na X (ID: ${tweetId}).`,
      "System-SocialMedia"
    );

    return tweetId;
  } catch (err) {
    console.error("[X AUTO-SHARE CRITICAL]:", err);
    await createLog(
      req,
      `[X BŁĄD KRYTYCZNY] Awaria połączenia z X API dla posta "${post.title}": ${err.message}`,
      "System-SocialMedia"
    );
    return null;
  }
}

/**
 * Usuwa opublikowany wcześniej tweet z platformy X po wycofaniu wpisu do szkicu lub jego usunięciu.
 */
async function deletePostFromX(post, req) {
  if (
    !process.env.X_API_KEY ||
    !process.env.X_ACCESS_TOKEN ||
    !post ||
    !post.xPostId
  ) {
    return false;
  }

  const tweetId = post.xPostId;
  const deleteUrl = `${X_API_TWEETS}/${tweetId}`;

  try {
    const authHeader = buildOAuth1Header("DELETE", deleteUrl);

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errorMsg = errData.detail || errData.title || response.statusText;
      console.error("[X AUTO-DELETE ERROR]:", errorMsg);
      await createLog(
        req,
        `[X BŁĄD USUWANIA] Nie udało się usunąć tweeta "${post.title}" (ID: ${tweetId}): ${errorMsg}`,
        "System-SocialMedia"
      );
      return false;
    }

    await Post.findByIdAndUpdate(post._id, { xPostId: null });

    console.log(`[X AUTO-DELETE] Usunięto tweet z X. Tweet ID: ${tweetId}`);
    await createLog(
      req,
      `[X AUTO-DELETE] Usunięto post "${post.title}" (ID: ${tweetId}) z platformy X po wycofaniu ze sfery publicznej.`,
      "System-SocialMedia"
    );

    return true;
  } catch (err) {
    console.error("[X AUTO-DELETE CRITICAL]:", err);
    return false;
  }
}

module.exports = { publishPostToX, deletePostFromX };
