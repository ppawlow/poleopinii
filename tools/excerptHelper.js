// tools/excerptHelper.js

/**
 * Usuwa tagi HTML oraz dekoduje podstawowe encje z edytora Quill
 */
function stripHtmlAndEntities(html) {
  return (html || "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wyciąga zajawkę artykułu:
 * 1. Priorytetowo z pierwszego bloku <blockquote> lub <quote> na początku wpisu.
 * 2. W przeciwnym razie pobiera maksymalnie `maxLength` znaków, cofając się do poprzedniego pełnego słowa.
 */
function generatePostExcerpt(htmlContent, maxLength = 220) {
  if (!htmlContent) return "";

  // Pomijamy ewentualne puste akapity na samym starcie artykułu (częste w Quillu)
  const cleanedStart = htmlContent
    .replace(/^(?:\s*<p>(?:\s|<br\s*\/?>|&nbsp;)*<\/p>\s*)+/i, "")
    .trim();

  // 1. Sprawdzenie bloku <blockquote> lub <quote> na początku treści
  const quoteMatch = cleanedStart.match(
    /^\s*<(?:blockquote|quote)[^>]*>([\s\S]*?)<\/(?:blockquote|quote)>/i
  );

  if (quoteMatch && quoteMatch[1]) {
    const quoteText = stripHtmlAndEntities(quoteMatch[1]);
    if (quoteText.length > 0) {
      return quoteText;
    }
  }

  // 2. Fallback: pierwsze X znaków bez ucinania w połowie słowa
  const plainFallback = stripHtmlAndEntities(cleanedStart);
  if (plainFallback.length <= maxLength) {
    return plainFallback;
  }

  const sliced = plainFallback.substring(0, maxLength);
  if (plainFallback[maxLength] !== " ") {
    const lastSpaceIndex = sliced.lastIndexOf(" ");
    if (lastSpaceIndex > 0) {
      return sliced.substring(0, lastSpaceIndex).trim() + "...";
    }
  }

  return sliced.trim() + "...";
}

module.exports = { generatePostExcerpt, stripHtmlAndEntities };
