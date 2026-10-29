const express = require("express");
const path = require("path");
const fsPromises = require("fs").promises;
const { ObjectId } = require("mongodb");
const mailer = require("../tools/mailer");

const {
  User,
  Post,
  createLog,
  createNotification,
  upload,
  getScopedPosts,
} = require("../tools/db");

const { POST_VISIBILITY, DEFAULT_ASSETS, SERVICE_NAME } = require("../config");

const {
  accessControl,
  hasPermission,
  sendAccessDenied,
  isAdminId,
  getProfile,
} = require("../tools/security");

const {
  handleApiValidationErrors,
  validateFileSignatures,
  postValidationRules,
  commentValidationRules,
  validateId,
  validateContent,
  validatePublicContent,
} = require("../tools/validation");

const postUpload = upload.single("postImage");
const editPostUpload = upload.single("editPostImage");

module.exports = express
  .Router()
  // Dostęp publiczny
  .get("/load-more", getLoadMore)
  .get("/:id", validateId("id"), getId)
  .post(
    "/report",
    postUpload,
    handleApiValidationErrors,
    postCreatePublicReport,
  )

  // Dostęp dla zalogowanych (Wstrzykuje użytkownika jako req.dbUser)
  .use(accessControl)

  .post(
    "/",
    postUpload,
    postValidationRules,
    handleApiValidationErrors,
    validateFileSignatures,
    postCreate,
  )

  .use("/:id", validateId("id"))
  .post("/:id/delete-image", postDeleteImage)

  .post(
    "/:id/edit",
    editPostUpload,
    postValidationRules,
    handleApiValidationErrors,
    validateFileSignatures,
    postEdit,
  )
  .post("/:id/revert-to-draft", postRevert)
  .post("/:id/like", postLike)
  .post("/:id/delete", postDelete)
  .post("/:id/appeal", postAppeal)

  .post(
    "/:id/comment",
    commentValidationRules,
    handleApiValidationErrors,
    postComment,
  )
  .use("/:id/comments", require("./comments"));

// OŚ CZASU / ARTYKUŁ SINGLE
async function getId(req, res) {
  try {
    const postId = req.params.id;

    // 1. Pobranie głównego posta za pomocą aggregate
    const { posts } = await getScopedPosts(req, {
      scope: "single",
      targetPostId: postId,
      limit: 1,
    });

    if (!posts || posts.length === 0) {
      return res
        .status(403)
        .send(
          "Brak uprawnień do wyświetlenia tego wpisu lub post nie istnieje.",
        );
    }

    const post = posts[0];
    const authorBio = (await getProfile(post.authorId)).bio || "";

    // 2. Pobranie innych postów tego samego autora dla sekcji bocznej
    const { posts: authorPosts } = await getScopedPosts(req, {
      scope: "profile",
      targetUserId: post.authorId,
      limit: 10,
    });

    const otherPosts = (authorPosts || [])
      .filter((p) => String(p._id) !== String(post._id))
      .slice(0, 5);

    // 3. Pobranie powiązanych postów polemicznych (debaty) oraz zgłoszeń nadużyć
    const abuseAndReplyPostsRaw = await Post.find({ parentPostId: post._id })
      .sort({ createdAt: -1 })
      .lean();

    const debatePosts = abuseAndReplyPostsRaw.filter((p) => !p.isAbuseReport);
    const userIsAdmin = isAdminId(req.session?.user?.id) || false;

    // KRYTYCZNA POPRAWKA BEZPIECZEŃSTWA: Całkowite wyczyszczenie danych sygnalisty (Biała lista)
    // Zamiast modyfikacji przez undefined, tworzymy całkowicie nowy, bezpieczny obiekt
    const abuseReports = abuseAndReplyPostsRaw
      .filter((p) => p.isAbuseReport)
      .map((report) => {
        if (!userIsAdmin) {
          return {
            _id: report._id,
            title: report.title,
            content: report.content,
            createdAt: report.createdAt,
            parentPostId: report.parentPostId,
            abuseCategory: report.abuseCategory,
            author: "Anonimowy Użytkownik", // Usunięto authorDetails oraz authorEmail
          };
        }
        return report; // Administrator widzi pełny raport audytowy
      });

    let userBlocks = [];
    if (req.session && req.session.user) {
      const dbUser = await User.findById(req.session.user.id);
      if (dbUser) {
        userBlocks = (dbUser.blocks || []).map((id) => id.toString());
      }
    }

    // 4. Przekazanie bezpiecznych struktur danych do renderowania widoku Pug
    res.render("single-post", {
      title: post.title || "Wpis",
      post,
      authorBio,
      otherPosts,
      debatePosts,
      abuseReports,
      userBlocks,
      currentTab: "none",
    });
  } catch (err) {
    console.error(
      "Błąd wczytywania pojedynczego posta przez getScopedPosts:",
      err,
    );
    res.status(500).send("Błąd serwera podczas wczytywania wpisu");
  }
}

async function postCreate(req, res) {
  let { title, content, visibility, parentPostId } = req.body;

  const cleanContent = validateContent(content);
  if (!cleanContent || cleanContent.trim() === "<p></p>") {
    return res
      .status(400)
      .send("Publikacja zablokowana: Niedozwolona lub pusta treść.");
  }

  try {
    const dbUser = req.dbUser;

    if (!parentPostId) {
      if (!hasPermission(dbUser, visibility, "CREATE")) {
        return sendAccessDenied(
          req,
          res,
          'Brak uprawnień: Aby odpowiadać na posty publiczne musisz zweryfikować profil. <a href="/verify" style="color: #1877f2; font-weight: bold; text-decoration: underline;">Dowiedz się więcej</a>',
        );
      }
    }

    if (parentPostId && ObjectId.isValid(parentPostId)) {
      const originalPost = await Post.findById(parentPostId);

      if (!originalPost) {
        return sendAccessDenied(req, res);
      }

      if (originalPost.isAbuseReport) {
        return res
          .status(400)
          .send(
            "Operacja niedozwolona: Nie można tworzyć artykułów polemicznych w odpowiedzi na zgłoszenie nadużycia.",
          );
      }

      const originalAuthor = await User.findById(originalPost.authorId);

      if (hasPermission(dbUser, "user", "canReplyWithPost", originalAuthor)) {
        if (!dbUser.isVerified) {
          visibility = "restricted";
        }
      } else {
        return res
          .status(403)
          .send(
            "Publikacja zablokowana: Aktywna relacja blokowania uniemożliwia odpowiedź lub brak uprawnień dyskusyjnych.",
          );
      }
    }

    // ==================================================
    // OBSŁUGA STRUMIENIOWANIA SSE DLA POSTÓW PUBLICZNYCH
    // ==================================================
    if (visibility === "public") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders(); // Wymuszenie wysłania nagłówków przez Nginx proxy

      const aiValidation = await validatePublicContent(
        req,
        title,
        cleanContent,
        res,
      );

      if (!aiValidation.approved) {
        res.write(
          `data: ${JSON.stringify({ status: "error", error: aiValidation.reason, report: aiValidation.factCheckReport })}\n\n`,
        );
        return res.end();
      }
    }

    let finalImageName = null;
    if (req.file) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(req.file.originalname).toLowerCase();
      finalImageName = "postImage-" + uniqueSuffix + ext;
      const targetPath = path.join(
        __dirname,
        "../public/uploads",
        finalImageName,
      );
      await fsPromises.writeFile(targetPath, req.file.buffer);
    }

    const decodedTitle = title
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ");

    const isReport = req.body.isAbuseReport === "true";
    const isReplyOrReport = parentPostId && ObjectId.isValid(parentPostId);

    const newPost = new Post({
      title: decodedTitle,
      author: dbUser.displayName,
      authorEmail: dbUser.email,
      authorId: dbUser._id,
      authorAvatar: dbUser.avatarUrl,
      content: cleanContent,
      visibility: isReplyOrReport ? "public" : visibility,
      imageUrl: finalImageName ? "/uploads/" + finalImageName : null,
      parentPostId: isReplyOrReport ? parentPostId : null,
      isAbuseReport: isReport,
      abuseCategory: isReport ? req.body.abuseCategory || "general" : "general",
    });

    const savedPost = await newPost.save();
    await createLog(req, `Utworzono post (${visibility}): ${title}`);

    let parentPostTitle = "Wpis bez tytułu";
    if (savedPost.parentPostId) {
      const parentDoc = await Post.findById(savedPost.parentPostId).select(
        "title authorId",
      );
      if (parentDoc) {
        parentPostTitle = parentDoc.title || "Wpis bez tytułu";
      }
    }

    if (savedPost.parentPostId) {
      const originalPost = await Post.findById(savedPost.parentPostId);

      if (
        originalPost &&
        String(originalPost.authorId) !== String(dbUser._id)
      ) {
        if (savedPost.isAbuseReport) {
          await mailer.sendAbuseReportEmail(originalPost, savedPost, req);
          await createLog(
            req,
            `[SYSTEM MAIL] Zarejestrowano i przekazano zgłoszenie nadużycia.`,
          );
        } else {
          const targetAuthorDoc = await User.findById(originalPost.authorId);
          if (targetAuthorDoc && targetAuthorDoc.email) {
            originalPost.authorEmail = targetAuthorDoc.email;
            await mailer.sendReplyNotificationEmail(
              dbUser,
              req,
              originalPost,
              savedPost,
            );
          }
        }
      }
    }

    const renderPost = {
      _id: savedPost._id,
      title: savedPost.title,
      content: savedPost.content,
      visibility: savedPost.visibility,
      imageUrl: savedPost.imageUrl,
      createdAt: savedPost.createdAt,
      parentPostId: savedPost.parentPostId,
      parentPostTitle: parentPostTitle,
      likesCount: 0,
      isLikedByMe: false,
      comments: [],
      author: dbUser.displayName,
      authorId: dbUser._id,
      authorDetails: {
        _id: dbUser._id,
        name: dbUser.displayName,
        avatarUrl: dbUser.avatarUrl || "/uploads/default-avatar.png",
        isFullyVerified:
          dbUser.isVerified === true &&
          dbUser.verificationTransferStatus === "approved",
      },
    };

    const { getProfileUrl, urlAliases } = res.locals;
    const isUserAdmin =
      typeof isAdminId === "function" ? isAdminId(dbUser._id) : false;

    return req.app.render(
      "partials/post-card",
      {
        post: renderPost,
        csrfToken: req.csrfToken(),
        user: req.session.user,
        userBlocks: (dbUser.blocks || []).map((id) => id.toString()),
        hasPermission,
        isAdmin: isUserAdmin,
        DEFAULT_ASSETS,
        getProfileUrl,
        urlAliases,
        SERVICE_NAME,
      },
      (renderErr, htmlSnippet) => {
        if (renderErr) {
          if (visibility === "public") {
            res.write(
              `data: ${JSON.stringify({ status: "error", error: "Błąd kompilacji szablonu interfejsu." })}\n\n`,
            );
            return res.end();
          }
          return res
            .status(500)
            .send("Błąd renderowania komponentu interfejsu.");
        }

        if (visibility === "public") {
          res.write(
            `data: ${JSON.stringify({ status: "success", html: htmlSnippet })}\n\n`,
          );
          return res.end();
        }

        return res.json({ success: true, html: htmlSnippet });
      },
    );
  } catch (err) {
    console.error("Błąd tworzenia posta:", err);
    if (visibility === "public") {
      res.write(
        `data: ${JSON.stringify({ status: "error", error: "Wewnętrzny błąd serwera." })}\n\n`,
      );
      return res.end();
    }
    return res.status(500).send("Błąd tworzenia posta");
  }
}

// routes/posts.js -> funkcja postEdit

async function postEdit(req, res) {
  const { title, content, visibility } = req.body;
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono wpisu.");
    if (String(post.authorId) !== String(req.session.user.id)) {
      return res.status(403).send("Brak uprawnień do edycji tego wpisu.");
    }

    if (post.visibility === "public" && visibility !== "public") {
      return res
        .status(400)
        .send("Posty publiczne nie mogą być modyfikowane bezpośrednio.");
    }

    const cleanContent = validateContent(content);
    if (!cleanContent || cleanContent.trim() === "") {
      return res
        .status(400)
        .send("Edycja odrzucona: Niedozwolona lub pusta treść.");
    }
    const dbUser = req.dbUser;

    if (post.isModeratorLocked && visibility === "public") {
      return res
        .status(403)
        .send(
          "Operacja zablokowana: Ten wpis został oznaczony przez moderatora jako nadużycie i nie może zostać ponownie upubliczniony.",
        );
    }

    // Standardowe sprawdzenie uprawnień przy zmianie widoczności (np. z restricted na public)
    if (visibility && visibility !== post.visibility) {
      if (!hasPermission(dbUser, visibility, "CREATE")) {
        return sendAccessDenied(
          req,
          res,
          "Brak uprawnień: Wymagana weryfikacja konta.",
        );
      }
    }

    // Flaga pomocnicza, która poinformuje nas czy uruchomiliśmy strumień Server-Sent Events (SSE)
    const isChangingToPublic =
      visibility === "public" && post.visibility !== "public";

    // =========================================================================
    // OBSŁUGA STRUMIENIOWANIA SSE DLA ZMIANY STATUSU NA PUBLICZNY
    // =========================================================================
    if (isChangingToPublic) {
      const targetTitle = title ? title.trim() : post.title;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const aiValidation = await validatePublicContent(
        req,
        targetTitle,
        cleanContent,
        res,
      );

      if (!aiValidation.approved) {
        res.write(
          `data: ${JSON.stringify({ status: "error", error: aiValidation.reason, report: aiValidation.factCheckReport })}\n\n`,
        );
        return res.end();
      }
    }
    // =========================================================================

    // Przetwarzanie nowej grafiki (jeśli została przesłana podczas poprawiania posta)
    if (req.file) {
      if (post.imageUrl) {
        const oldImagePath = path.join(__dirname, "../public", post.imageUrl);
        const resolvedOldPath = path.resolve(oldImagePath);
        const allowedUploadDir = path.resolve(__dirname, "../public/uploads");
        if (resolvedOldPath.startsWith(allowedUploadDir)) {
          try {
            await fsPromises.unlink(resolvedOldPath);
          } catch (e) {
            if (e.code !== "ENOENT")
              console.error("Błąd usuwania starego pliku posta:", e);
          }
        }
      }
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(req.file.originalname).toLowerCase();
      const finalImageName = "editPostImage-" + uniqueSuffix + ext;
      const targetPath = path.join(
        __dirname,
        "../public/uploads",
        finalImageName,
      );
      await fsPromises.writeFile(targetPath, req.file.buffer);
      post.imageUrl = "/uploads/" + finalImageName;
    }

    // Zapis zmian wprowadzonych przez autora
    post.author = dbUser.displayName;
    post.authorAvatar = dbUser.avatarUrl;
    post.authorEmail = dbUser.email;

    if (visibility && POST_VISIBILITY.includes(visibility)) {
      post.visibility = visibility;
    }

    if (title && title.trim().length > 0) {
      post.title = title
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
    }

    post.content = cleanContent;

    await post.save();

    // KRYTYCZNA POPRAWKA: Jeśli strumień był otwarty, zamykamy go dedykowaną wiadomością SSE i kończymy połączenie
    if (isChangingToPublic) {
      res.write(`data: ${JSON.stringify({ status: "edit_success" })}\n\n`);
      return res.end();
    }

    // Klasyczna, czysta odpowiedź HTTP dla postów prywatnych / restricted (gdy strumień nie był otwierany)
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd edycji posta:", err);

    // Zabezpieczenie na wypadek awarii wewnątrz aktywnego strumienia
    if (visibility === "public" && post && post.visibility !== "public") {
      try {
        res.write(
          `data: ${JSON.stringify({ status: "error", error: "Wewnętrzny błąd serwera." })}\n\n`,
        );
        return res.end();
      } catch (e) {}
    }

    return res
      .status(500)
      .send("Wewnętrzny błąd serwera podczas edycji wpisu.");
  }
}

// WYCOFANIE DO SZKICU
async function postRevert(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono wpisu.");
    if (String(post.authorId) !== String(req.session.user.id)) {
      return res.status(403).send("Brak uprawnień do modyfikacji tego zasobu.");
    }
    post.visibility = "private";
    await post.save();
    await createLog(req, `Wycofano post do szkicu: ${post.title}`);
    return res.json({ id: post._id });
  } catch (err) {
    console.error("Błąd wycofywania wpisu do szkicu:", err);
    return res.status(500).send("Błąd serwera podczas wycofywania wpisu.");
  }
}
// ==========================================
// KOMENTOWANIE POSTU (Z INTEGRACJĄ MATRYCY UPRAWNIEŃ)
// ==========================================
async function postComment(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono posta.");
    const dbUser = req.dbUser;
    // =========================================================================
    // NOWOŚĆ: ZCENTRALIZOWANE SPRAWDZENIE UPRAWNIEŃ DO KOMENTOWANIA
    // =========================================================================
    if (!hasPermission(dbUser, post.visibility, "COMMENT")) {
      return sendAccessDenied(
        req,
        res,
        "Brak uprawnień: Komentowanie postów publicznych wymaga pełnej weryfikacji konta. Dowiedz się więcej",
      );
    }
    // =========================================================================
    const postAuthor = await User.findById(post.authorId);
    if (postAuthor) {
      const iBlockHim = dbUser.blocks.includes(postAuthor._id);
      const heBlocksMe = postAuthor.blocks.includes(dbUser._id);
      if (iBlockHim || heBlocksMe) {
        return res
          .status(403)
          .send(
            "Operacja zablokowana: Aktywna blokada uniemożliwia dodanie komentarza.",
          );
      }
    }
    const cleanContent = validateContent(req.body.content);
    if (!cleanContent || cleanContent.trim() === "") {
      return res.status(400).send("Dodawanie zablokowane: Pusta treść.");
    }
    const isReply = req.body.content.trim().startsWith("@");
    let recipientId = post.authorId;
    let notificationType = "comment_post";
    const commentData = {
      author: dbUser.displayName,
      authorEmail: dbUser.email,
      authorId: dbUser._id,
      authorAvatar: dbUser.avatarUrl || DEFAULT_ASSETS.avatar,
      content: cleanContent,
      likedBy: [],
    };
    post.comments.push(commentData);
    const savedPost = await post.save();
    const addedComment = savedPost.comments[savedPost.comments.length - 1];
    if (isReply) {
      const mentionMatch = req.body.content.match(/^@([^\s]+)/);
      if (mentionMatch) {
        const targetName = mentionMatch[1];
        const targetUser = await User.findOne({
          $or: [{ nickname: targetName }, { name: targetName }],
        });
        if (targetUser) {
          const iBlockMentioned = dbUser.blocks.includes(targetUser._id);
          const mentionedBlocksMe = targetUser.blocks.includes(dbUser._id);
          if (!iBlockMentioned && !mentionedBlocksMe) {
            recipientId = targetUser._id;
            notificationType = "reply_comment";
          }
        }
      }
    }
    await createNotification({
      senderId: dbUser._id,
      recipientId,
      type: notificationType,
      postId: post._id,
      commentId: addedComment._id,
    });
    await createLog(
      req,
      `Dodano komentarz do posta użytkownika ${post.author}`,
    );

    const { getProfileUrl, urlAliases } = res.locals;

    // Tworzymy miniaturowy, sztuczny kontekst posta zawierający TYLKO ten jeden nowy komentarz
    const renderContext = {
      post: {
        _id: post._id,
        comments: [
          {
            _id: addedComment._id,
            content: addedComment.content,
            author: dbUser.displayName,
            authorId: dbUser._id,
            authorAvatar: dbUser.avatarUrl || DEFAULT_ASSETS.avatar,
            likedBy: [],
            isFullyVerified:
              dbUser.isVerified === true &&
              dbUser.verificationTransferStatus === "approved",
          },
        ],
      },
      csrfToken: req.csrfToken(),
      user: req.session.user,
      getProfileUrl,
      urlAliases,
      hasPermission, // Przydatne dla spójności silnika szablonów
      DEFAULT_ASSETS,
    };

    return req.app.render(
      "partials/post-comments",
      renderContext,
      (renderErr, htmlSnippet) => {
        if (renderErr)
          return res.status(500).send("Błąd renderowania komentarza.");

        // Odsyłamy skompilowany przez Pug czysty HTML nowego komentarza
        return res.json({ success: true, html: htmlSnippet });
      },
    );
  } catch (err) {
    console.error("Błąd podczas dodawania komentarza:", err);
    return res.status(500).send("Błąd serwera.");
  }
}
// ==========================================
// LAJKOWANIE POSTA (Z INTEGRACJĄ MATRYCY UPRAWNIEŃ)
// ==========================================
async function postLike(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send("Niepoprawny format identyfikatora wpisu.");
  }
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono posta.");
    const dbUser = req.dbUser;

    // Zcentralizowane sprawdzenie uprawnień do polubień posta
    if (!hasPermission(dbUser, post.visibility, "LIKE")) {
      return sendAccessDenied(
        req,
        res,
        "Brak uprawnień: Polubienie postów publicznych wymaga pełnej weryfikacji konta. Dowiedz się więcej",
      );
    }

    const postAuthor = await User.findById(post.authorId);
    if (postAuthor) {
      const iBlockHim = dbUser.blocks.includes(postAuthor._id);
      const heBlocksMe = postAuthor.blocks.includes(dbUser._id);
      if (iBlockHim || heBlocksMe) {
        return res
          .status(403)
          .send(
            "Operacja zablokowana: Aktywna blokada uniemożliwia polubienie tego wpisu.",
          );
      }
    }

    // =========================================================================
    // POPRAWKA: Zmiana identyfikacji z adresu E-mail na unikalne ID (String)
    // =========================================================================
    const userIdStr = String(req.session.user.id);
    const index = post.likedBy.indexOf(userIdStr);
    let actionText = "";

    if (index === -1) {
      post.likedBy.push(userIdStr); // Zapisujemy unikalne ID
      actionText = `Polubiono post użytkownika ${post.author}`;

      if (String(dbUser._id) !== String(post.authorId)) {
        await createNotification({
          senderId: dbUser._id,
          recipientId: post.authorId,
          type: "like_post",
          postId: post._id,
        });
      }
    } else {
      post.likedBy.splice(index, 1); // Usuwamy unikalne ID
      actionText = `Cofnięto polubienie posta użytkownika ${post.author}`;
    }
    // =========================================================================

    await post.save();
    await createLog(req, actionText, dbUser.email);

    return res.json({
      success: true,
      liked: index === -1,
      likesCount: post.likedBy.length,
    });
  } catch (err) {
    console.error("Błąd lajkowania posta:", err);
    return res.status(500).send("Błąd serwera podczas polubienia wpisu.");
  }
}
// STRONICOWANIE
async function getLoadMore(req, res) {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = 5;
    const { posts, totalPosts } = await getScopedPosts(req, {
      scope: "home",
      skip,
      limit,
    });
    const hasMore = totalPosts > skip + limit;
    const app = req.app;
    let htmlOutput = "";

    const { getProfileUrl, urlAliases } = res.locals;

    for (const post of posts) {
      const renderContext = {
        post,
        csrfToken: req.csrfToken(),
        user:
          req.session && req.session.user
            ? {
                id: req.session.user.id,
                name: req.session.user.name,
                avatarUrl: req.session.user.avatarUrl,
                isFullyVerified: req.session.user.isFullyVerified || false,
              }
            : null,
        getProfileUrl,
        urlAliases,
        hasPermission: hasPermission,
        DEFAULT_ASSETS: DEFAULT_ASSETS,
      };
      const htmlSnippet = await new Promise((resolve, reject) => {
        app.render("partials/post-card", renderContext, (err, html) => {
          if (err) return reject(err);
          resolve(html);
        });
      });
      htmlOutput += htmlSnippet;
    }
    res.json({ html: htmlOutput, hasMore: hasMore });
  } catch (err) {
    res.status(500).json({ error: "Błąd ładowania" });
  }
}
// routes/posts.js

async function postDelete(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send("Niepoprawny format identyfikatora wpisu.");
  }
  try {
    const postId = req.params.id;
    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).send("Nie znaleziono posta w bazie danych.");
    }

    // Autoryzacja właściciela wpisu
    if (
      !post.authorId ||
      String(post.authorId) !== String(req.session.user.id)
    ) {
      return res
        .status(403)
        .send("Brak uprawnień: Nie jesteś właścicielem tego wpisu.");
    }

    // 1. Usuwanie fizycznego pliku graficznego z dysku serwera
    if (post.imageUrl) {
      const imagePath = path.join(__dirname, "../public", post.imageUrl);
      const resolvedPath = path.resolve(imagePath);
      const allowedUploadDir = path.resolve(__dirname, "../public/uploads");
      if (resolvedPath.startsWith(allowedUploadDir)) {
        try {
          await fsPromises.unlink(resolvedPath);
        } catch (fileErr) {
          if (fileErr.code !== "ENOENT") {
            console.error("Nie udało się usunąć pliku z dysku:", fileErr);
          }
        }
      }
    }

    // =========================================================================
    // NOWOŚĆ: CZYSZCZENIE KASKADOWE RELACJI BAZODANOWYCH
    // =========================================================================
    const { Notification } = require("../tools/db");

    // A. Usuwamy wszystkie powiadomienia (lajki, komentarze) powiązane z tym postem
    await Notification.deleteMany({ postId: post._id });

    // B. Usuwamy wszystkie zgłoszenia nadużyć, które dotyczyły tego posta
    // (Ponieważ zgłoszenie bez posta traci rację bytu w systemie)
    await Post.deleteMany({ parentPostId: post._id, isAbuseReport: true });

    // C. Dla zwykłych artykułów polemicznych (debaty) NIE usuwamy ich treści,
    // ale bezpiecznie odpinamy relację nadrzędną, ustawiając parentPostId na null,
    // by nie zaburzać aggregate osi czasu, informując widok, że oryginał usunięto.
    await Post.updateMany(
      { parentPostId: post._id, isAbuseReport: false },
      { $set: { parentPostId: null } },
    );
    // =========================================================================

    // 2. Bezwzględne usunięcie głównego dokumentu posta
    await Post.findByIdAndDelete(post._id);

    await createLog(
      req,
      `Usunięto post wraz z kaskadą powiązań: ${post.title}`,
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd serwera podczas kaskadowego usuwania wpisu:", err);
    return res.status(500).send("Błąd serwera podczas usuwania wpisu.");
  }
}

async function postDeleteImage(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono wpisu.");
    if (String(post.authorId) !== String(req.session.user.id)) {
      return res.status(403).send("Brak uprawnień do edycji tego zasobu.");
    }
    if (post.visibility === "public") {
      return res
        .status(400)
        .send("Nie można modyfikować postów publicznych bezpośrednio.");
    }

    if (post.imageUrl) {
      const imagePath = path.join(__dirname, "../public", post.imageUrl);
      const resolvedPath = path.resolve(imagePath);
      const allowedUploadDir = path.resolve(__dirname, "../public/uploads");

      if (resolvedPath.startsWith(allowedUploadDir)) {
        try {
          await fsPromises.unlink(resolvedPath);
        } catch (e) {
          if (e.code !== "ENOENT")
            console.error("Błąd usuwania pliku graficznego z dysku:", e);
        }
      }
      post.imageUrl = null;
      await post.save();
      await createLog(req, `Usunięto grafikę z posta: ${post.title}`);
      return res.sendStatus(200);
    }
    return res.status(400).send("Ten post nie posiada przypisanej grafiki.");
  } catch (err) {
    console.error("Błąd metody postDeleteImage:", err);
    return res.status(500).send("Błąd serwera.");
  }
}

async function postAppeal(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Nie znaleziono wpisu.");
    if (String(post.authorId) !== String(req.session.user.id)) {
      return res.status(403).send("Brak uprawnień do tego zasobu.");
    }

    // Sprawdzamy, czy odwołanie nie zostało już wysłane, szukając duplikatu zgłoszenia
    const existingAppeal = await Post.findOne({
      parentPostId: post._id,
      isAbuseReport: true,
      author: "Odwołanie od AI",
    });
    if (existingAppeal) {
      return res
        .status(400)
        .send(
          "Odwołanie dla tego wpisu zostało już zarejestrowane w systemie.",
        );
    }

    // Tworzymy zgłoszenie nadużycia, gdzie autorem i zgłaszającym jest system odwołań
    const appealReport = new Post({
      title: `⚖️ ODWOŁANIE OD DECYZJI AI: "${post.title}"`,
      author: "Odwołanie od AI",
      authorEmail: post.authorEmail,
      authorId: post.authorId,
      content: `Użytkownik <b>${post.author}</b> zakwestionował werdykt sztucznej inteligencji i prosi o manualną weryfikację treści przez człowieka. Artykuł został zablokowany z powodu rzekomego fake-news lub naruszenia zasad.`,
      visibility: "public",
      parentPostId: post._id,
      isAbuseReport: true, // Dzięki temu trafi prosto do panelu admina!
    });

    await appealReport.save();

    // Wysyłamy powiadomienie mailowe do głównego administratora platformy
    const mailer = require("../tools/mailer");
    const adminUrl = `${req.protocol}://${req.get("host")}/admin`;
    const mailContent = `<p>Użytkownik poprosił o manualny audyt wpisu: <b>"${post.title}"</b>.</p><p><a href="${adminUrl}">Przejdź do Panelu Administratora</a></p>`;
    await mailer.sendMail(
      process.env.MAIN_ADMIN_EMAIL || "admin@poleopinii.pl",
      "⚖️ Nowe odwołanie od decyzji AI",
      mailContent,
    );

    await createLog(
      req,
      `[ODWOŁANIE] Użytkownik ${post.author} odwołał się od decyzji AI dla posta: ${post._id}`,
    );
    return res.sendStatus(200);
  } catch (err) {
    console.error("Błąd podczas zgłaszania odwołania do admina:", err);
    return res.status(500).send("Wewnętrzny błąd serwera.");
  }
}

/**
 * HANDLER: Przyjmowanie zgłoszeń nadużyć (w tym łamania praw autorskich)
 * od użytkowników zalogowanych oraz niezalogowanych Gości.
 * Zintegrowany z reżącym reżimem prawnym DSA oraz systemem reCAPTCHA Enterprise.
 */
async function postCreatePublicReport(req, res) {
  let { content, parentPostId, abuseCategory, reporterEmail, recaptchaToken } =
    req.body;
  const { useRecaptcha } = require("../config");

  // 1. Krytyczna walidacja obecności tokenu bezpieczeństwa
  if (!recaptchaToken) {
    return res
      .status(400)
      .send("Błąd bezpieczeństwa: Brak tokenu weryfikacji anty-botowej.");
  }

  try {
    // =========================================================================
    // SYSTEM WERYFIKACJI ANTY-BOTOWEJ (RECAPTCHA ENTERPRISE)
    // =========================================================================
    if (!useRecaptcha && recaptchaToken === "BYPASS_TOKEN_CAPTCHA_DISABLED") {
      // SCENARIUSZ A: reCAPTCHA wyłączona centralnie w pliku config.js (Tryb deweloperski/testowy)
      const ip = req.ip || "127.0.0.1";
      console.log(
        `[reCAPTCHA OMINIĘCIE] Przepuszczono żądanie przy wyłączonej fladze systemowej. IP: ${ip}`,
      );
    } else {
      // SCENARIUSZ B: Środowisko produkcyjne - Pełna weryfikacja w chmurze Google Enterprise
      const { RECAPTCHA_SECRET_KEY } = require("../config");

      // Odpytanie oficjalnego API Google Cloud Enterprise w celu oceny ryzyka spamu
      const verificationUrl = "https://www.google.com/recaptcha/api/siteverify";
      const params = new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: recaptchaToken,
        remoteip: req.ip || "127.0.0.1", // Przekazujemy prawdziwe IP użytkownika zza proxy Nginxa
      });

      const captchaResponse = await fetch(verificationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const captchaData = await captchaResponse.json();

      // Próg 0.5 chroni przed zautomatyzowanymi skryptami i farmami botów
      if (!captchaData.success || captchaData.score < 0.5) {
        const ip = req.ip || "127.0.0.1";
        const { SystemLog } = require("../tools/db");

        await SystemLog.create({
          email: reporterEmail || "Niezalogowany Bot",
          action: `[reCAPTCHA BLOKADA] Zablokowano podejrzany ruch jako bot-spam (Score: ${captchaData.score || 0})`,
          ipAddress: ip,
        });

        return res
          .status(403)
          .send(
            "Weryfikacja anty-botowa nieudana. Żądanie ocenione jako automatyczny spam.",
          );
      }
    }

    // =========================================================================
    // WALIDACJA ZAWARTOŚCI I POWIĄZAŃ ARTYKUŁÓW
    // =========================================================================
    const cleanContent = validateContent(content);
    if (
      !cleanContent ||
      cleanContent.trim() === "" ||
      cleanContent.trim() === "<p></p>"
    ) {
      return res
        .status(400)
        .send("Zgłoszenie odrzucone: Uzasadnienie nie może być puste.");
    }

    if (!parentPostId || !ObjectId.isValid(parentPostId)) {
      return res
        .status(400)
        .send("Błąd: Nieprawidłowy identyfikator zgłaszanego artykułu.");
    }

    const originalPost = await Post.findById(parentPostId);
    if (!originalPost) {
      return res.status(404).send("Błąd: Zgłaszany artykuł nie istnieje.");
    }

    let authorEmailAddress = reporterEmail ? reporterEmail.trim() : null;
    let authorId = null;

    // Pobranie kontekstu tożsamości sygnalisty
    if (req.dbUser) {
      // Scenariusz zalogowany: Przypisujemy unikalne identyfikatory z sesji
      authorEmailAddress = req.dbUser.email;
      authorId = req.dbUser._id;
    } else {
      // Scenariusz Gość: Wymóg walidacji e-mail kontaktu zewnętrznego (Wymóg DSA)
      if (!authorEmailAddress || !authorEmailAddress.includes("@")) {
        return res
          .status(400)
          .send(
            "Błąd walidacji: Podaj poprawny adres e-mail do kontaktu w sprawie zgłoszenia.",
          );
      }
    }

    const titleText = `⚠️ ZGŁOSZENIE NADUŻYCIA: "${originalPost.title || "Wpis bez tytułu"}"`;

    // =========================================================================
    // TWORZENIE I UTRWALANIE DOKUMENTU ZGŁOSZENIA NADUŻYCIA (ABUSE)
    // =========================================================================
    const newReport = new Post({
      title: titleText,
      author: "Anonimowy Użytkownik", // Wymuszona anonimowość na poziomie interfejsu (Ochrona Sygnalistów)
      authorEmail: authorEmailAddress, // Zachowujemy e-mail w bazie, by moderator mógł wysłać decyzję
      authorId: authorId || new ObjectId("000000000000000000000000"), // Techniczny fallback dla Gościa
      content: cleanContent,
      visibility: "public", // Zgłoszenia nadużyć są prewencyjnie publiczne, by tworzyć jawny wątek debaty i obrony
      parentPostId: originalPost._id,
      isAbuseReport: true,
      abuseCategory: abuseCategory || "general", // Segregacja roszczeń (general / copyright)
    });

    const savedReport = await newReport.save();

    // Zapis bezpiecznego audytu systemowego w bazie MongoDB
    const ip = req.ip || "127.0.0.1";
    const { SystemLog } = require("../tools/db");
    await SystemLog.create({
      email: authorEmailAddress,
      action: `[ZAREJESTROWANO RAPORT ABUSE] Typ: ${savedReport.abuseCategory.toUpperCase()} | Dla posta o ID: ${originalPost._id}`,
      ipAddress: ip,
    });

    // Uruchomienie automatyzacji mailingowej (Notice and Takedown / Informacja dla stron)
    await mailer.sendAbuseReportEmail(originalPost, savedReport, req);

    return res.json({
      success: true,
      msg: "Zgłoszenie zostało pomyślnie zarejestrowane i przekazane do działu moderacji.",
    });
  } catch (err) {
    console.error(
      "Krytyczny błąd wewnątrz metody postCreatePublicReport:",
      err,
    );
    return res
      .status(500)
      .send("Wewnętrzny błąd serwera podczas walidacji lub zapisu zgłoszenia.");
  }
}
