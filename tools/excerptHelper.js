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
 * Przycina tekst do maksymalnej długości `maxLength` (wliczając 3 kropki),
 * cofając się do końca ostatniego pełnego słowa i czyszcząc wiszącą interpunkcję.
 */
function truncateToWord(text, maxLength) {
  const cleanText = (text || "").trim();
  if (maxLength <= 0) return "";
  if (cleanText.length <= maxLength) return cleanText;

  // Zostawiamy miejsce na "..." (3 znaki)
  const hardLimit = Math.max(0, maxLength - 3);
  if (hardLimit === 0) return "";

  let sliced = cleanText.substring(0, hardLimit);

  // Jeśli cięcie nie wypadło idealnie na spacji, cofamy się do końca poprzedniego słowa
  if (cleanText[hardLimit] !== " ") {
    const lastSpaceIndex = sliced.lastIndexOf(" ");
    if (lastSpaceIndex > 0) {
      sliced = sliced.substring(0, lastSpaceIndex);
    }
  }

  // Usuwamy zbędne znaki interpunkcyjne z końca przed dodaniem wielokropka
  sliced = sliced.replace(/[,;:!?\-–—.]+$/, "").trim();

  return sliced ? `${sliced}...` : "";
}

/**
 * Wyciąga zajawkę artykułu:
 * 1. Priorytetowo z pierwszego bloku <lead>, <blockquote> lub <quote> na początku wpisu.
 * 2. W przeciwnym razie pobiera maksymalnie `maxLength` znaków, cofając się do poprzedniego pełnego słowa.
 */
function generatePostExcerpt(htmlContent, maxLength = 220) {
  if (!htmlContent) return "";

  // Pomijamy ewentualne puste akapity na samym starcie artykułu (częste w Quillu)
  const cleanedStart = htmlContent
    .replace(/^(?:\s*<p>(?:\s|<br\s*\/?>|&nbsp;)*<\/p>\s*)+/i, "")
    .trim();

  // 1. Sprawdzenie bloku <lead>, <blockquote> lub <quote> na początku treści (z zachowaniem limitu maxLength!)
  const quoteMatch = cleanedStart.match(
    /^\s*<(?:lead|blockquote|quote)[^>]*>([\s\S]*?)<\/(?:lead|blockquote|quote)>/i
  );

  if (quoteMatch && quoteMatch[1]) {
    const quoteText = stripHtmlAndEntities(quoteMatch[1]);
    if (quoteText.length > 0) {
      return truncateToWord(quoteText, maxLength);
    }
  }

  // 2. Fallback: pierwsze X znaków bez ucinania w połowie słowa
  const plainFallback = stripHtmlAndEntities(cleanedStart);
  return truncateToWord(plainFallback, maxLength);
}

module.exports = { generatePostExcerpt, stripHtmlAndEntities, truncateToWord };
