// === routes/comments.js ===
const express = require("express");

const {
  User,
  Post,
  createLog,
  // upload,
  // getScopedPosts,
} = require("../tools/db");

const { POST_VISIBILITY, DEFAULT_ASSETS } = require("../config");

// DODANO: Import zcentralizowanego silnika uprawnień i obsługi blokad dostępu
const {
  accessControl,
  hasPermission,
  sendAccessDenied,
} = require("../tools/security");

const {
  handleApiValidationErrors,
  commentValidationRules,
  validateId,
  validateContent,
} = require("../tools/validation");

module.exports = express
  .Router({ mergeParams: true })
  // Dostęp dla zalogowanych
  .use(accessControl)
  .use("/:commentId", validateId("commentId"))
  .post("/:commentId/like", postCommentLike)
  .post("/:commentId/delete", postCommentDelete)
  .post(
    "/:commentId/edit",
    commentValidationRules,
    handleApiValidationErrors,
    postCommentEdit,
  );

// ==========================================
// Reedycja komentarza
// ==========================================
async function postCommentEdit(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post)
      return res.status(404).send("Nie odnaleziono powiązanego posta.");

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).send("Komentarz nie istnieje.");

    // Weryfikacja autora komentarza (IDOR Protection)
    if (
      !comment.authorId ||
      !req.session.user.id ||
      String(comment.authorId) !== String(req.session.user.id)
    ) {
      return res.status(403).send("Brak uprawnień do edycji tego komentarza.");
    }

    // OCHRONA XSS: Filtrowanie danych wejściowych przy edycji komentarza
    const cleanContent = validateContent(req.body.content);

    // Zabezpieczenie przed pustą reedycją
    if (
      !cleanContent ||
      cleanContent.trim() === "" ||
      cleanContent.trim() === "<p></p>"
    ) {
      return res
        .status(400)
        .send("Edycja odrzucona: Niedozwolona lub pusta treść komentarza.");
    }

    comment.content = cleanContent;
    await post.save();
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd edycji komentarza:", err);
    return res.status(500).send("Wewnętrzny błąd serwera.");
  }
}

// ==========================================
// Polubienie komentarza
// ==========================================
async function postCommentLike(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono posta.");

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).send("Komentarz nie istnieje.");

    const dbUser = req.dbUser;

    if (!hasPermission(dbUser, post.visibility, "COMMENT")) {
      return sendAccessDenied(
        req,
        res,
        'Brak uprawnień: Polubienie komentarza pod postem publicznym wymaga pełnej weryfikacji konta. <a href="/verify" style="color: #1877f2; font-weight: bold; text-decoration: underline;">Dowiedz się więcej</a>',
      );
    }

    const postAuthor = await User.findById(post.authorId);
    const commentAuthor = await User.findById(comment.authorId);

    const isPostAuthorBlocked =
      postAuthor &&
      (dbUser.blocks.includes(postAuthor._id) ||
        postAuthor.blocks.includes(dbUser._id));
    const isCommentAuthorBlocked =
      commentAuthor &&
      (dbUser.blocks.includes(commentAuthor._id) ||
        commentAuthor.blocks.includes(dbUser._id));

    if (isPostAuthorBlocked || isCommentAuthorBlocked) {
      return res
        .status(403)
        .send(
          "Operacja zablokowana: Aktywna blokada uniemożliwia polubienie tego komentarza.",
        );
    }

    // =========================================================================
    // POPRAWKA: Zmiana identyfikacji z adresu E-mail na unikalne ID (String)
    // =========================================================================
    const userIdStr = String(req.session.user.id);
    const index = comment.likedBy.indexOf(userIdStr);

    if (index === -1) {
      comment.likedBy.push(userIdStr); // Zapisujemy unikalne ID
    } else {
      comment.likedBy.splice(index, 1); // Usuwamy unikalne ID
    }
    // =========================================================================

    await post.save();

    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({
        success: true,
        liked: comment.likedBy.includes(userIdStr),
        likesCount: comment.likedBy.length,
      });
    }

    return res.redirect(
      `${(req.get("Referrer") || "/").split("#")[0]}#comment-${comment._id}`,
    );
  } catch (err) {
    console.error("Błąd lajkowania komentarza:", err);
    return res.status(500).send("Błąd przetwarzania żądania.");
  }
}

// ==========================================
// Usuwanie komentarza
// ==========================================
async function postCommentDelete(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post)
      return res.status(404).send("Nie odnaleziono powiązanego posta.");
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).send("Komentarz nie istnieje.");
    if (!comment.authorId || !req.session.user.id) {
      return res
        .status(403)
        .send("Brak uprawnień: Niepoprawny kontekst autoryzacji zasobu.");
    }
    const isCommentAuthor =
      String(comment.authorId) === String(req.session.user.id);
    const isPostAuthor =
      post.authorId && String(post.authorId) === String(req.session.user.id);
    if (!isCommentAuthor && !isPostAuthor) {
      return res
        .status(403)
        .send(
          "Brak uprawnień: Nie jesteś autorem tego komentarza ani właścicielem wpisu.",
        );
    }
    post.comments.pull(req.params.commentId);
    await post.save();
    await createLog(
      req,
      `Usunięto komentarz o ID ${req.params.commentId} z posta o ID ${post._id}`,
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd usuwania komentarza:", err);
    return res
      .status(500)
      .send("Wewnętrzny błąd serwera podczas usuwania komentarza.");
  }
}
