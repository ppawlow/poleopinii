// tools/user.js
const mongoose = require("mongoose");
const sanitizeHtml = require("sanitize-html");
const crypto = require("crypto"); // Upewnij się, że crypto jest zaimportowane na górze
const bcrypt = require("bcrypt");
const { DEFAULT_ASSETS, SALT_ROUNDS } = require("../config");
const { ObjectId } = require("mongodb");

function generateSecureTransferCode() {
  return "VERIFY-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}
function canonicalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  const cleanEmail = email.trim().toLowerCase();
  const parts = cleanEmail.split("@");
  if (parts.length !== 2) return cleanEmail;

  let [localPart, domain] = parts;
  localPart = localPart.replace(/\./g, "");
  localPart = localPart.split("+")[0];

  return `${localPart}@${domain}`;
}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  normalizedEmail: { type: String, required: true, unique: true },
  alias: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
  },
    role: { 
    type: String, 
    enum: ["user", "editor"], 
    default: "user" 
  },
  isVerified: { type: Boolean, default: false },
  newEmailPending: { type: String, default: null },
  avatarUrl: { type: String, default: DEFAULT_ASSETS.avatar },
  coverUrl: { type: String, default: DEFAULT_ASSETS.cover },
  allowPrivateEmails: { type: Boolean, default: false },
  securityToken: { type: String, default: null },
  securityTokenExpires: { type: Date, default: null },
  verificationBankAccount: { type: String, default: null },
  verificationTransferCode: {
    type: String,
    default: generateSecureTransferCode,
  },
  verificationTransferStatus: {
    type: String,
    enum: ["pending_submission", "processing", "approved", "rejected"],
    default: "pending_submission",
  },
  aiBlockedSafetyCount: { type: Number, default: 0 },
  aiBlockedFactCheckCount: { type: Number, default: 0 },
  bio: {
    type: String,
    default: "Nie dodano jeszcze żadnych informacji o sobie.",
    set: function (val) {
      let clean = (val || "").trim();
      return (
        sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }) ||
        "Nie dodano jeszcze żadnych informacji o sobie."
      );
    },
  },
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  blocks: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: {
    type: Date,
    default: Date.now,
    get: function (val) {
      if (val) return val;
      return this._id && typeof this._id.getTimestamp === "function"
        ? this._id.getTimestamp()
        : null;
    },
  },
});

userSchema.virtual("isFullyVerified").get(function () {
  return (
    this.isVerified === true && this.verificationTransferStatus === "approved"
  );
});

userSchema.virtual("isEditor").get(function () {
  return this.role === "editor";
});

userSchema.virtual("isPublicAllowed").get(function () {
  return this.isEditor || this.isFullyVerified
});

userSchema.methods.isOwnerOf = function (post) {
  if (!post || !post.authorId) return false;
  return this._id.equals(post.authorId);
};

userSchema
  .virtual("token")
  .get(function () {
    if (
      this.securityTokenExpires &&
      Date.now() > this.securityTokenExpires.getTime()
    ) {
      this.securityToken = undefined;
      this.securityTokenExpires = undefined;
      return null;
    }
    return this.securityToken || null;
  })
  .set(function (hours) {
    if (!hours || hours <= 0) {
      this.securityToken = undefined;
      this.securityTokenExpires = undefined;
      return;
    }
    const msec = hours * 3600000;
    this.securityToken = crypto.randomBytes(32).toString("hex");
    this.securityTokenExpires = new Date(Date.now() + msec);
  });

userSchema.methods.isBlocking = function (userId) {
  const targetId = userId._id || userId;
  return this.blocks.some((id) => id.equals(targetId));
};

userSchema.methods.isFollowing = function (userId) {
  const targetId = userId._id || userId;
  return this.following.some((id) => id.equals(targetId));
};

userSchema.virtual("displayName").get(function () {
  return this.name;
});

function resolveProfileUrl(userDetails) {
  if (!userDetails) return "/";
  if (typeof userDetails === "string") return `/profile/${userDetails}`;
  const userAlias = userDetails.alias || userDetails.authorDetails?.alias;
  const userId = userDetails._id || userDetails.id || userDetails.authorId;
  if (userAlias) return `/profile/${userAlias}`;
  if (userId) return `/profile/${userId.toString()}`;
  return "/";
}

userSchema.methods.getProfileUrl = function (userDetails = this) {
  return resolveProfileUrl(userDetails);
};

userSchema.statics.getProfileUrl = resolveProfileUrl;

userSchema.virtual("profileUrl").get(function () {
  return resolveProfileUrl(this);
});

userSchema.set("toObject", { virtuals: true, getters: true });
userSchema.set("toJSON", { virtuals: true, getters: true });

userSchema.options.toObject.transform = (doc, ret) => {
  ret.isFullyVerified =
    doc.isVerified === true && doc.verificationTransferStatus === "approved";
  return ret;
};
userSchema.options.toJSON.transform = userSchema.options.toObject.transform;

const User = mongoose.model("User", userSchema);

// --- FUNKCJE LOGICZNE ZWIĄZANE Z UŻYTKOWNIKIEM ---

async function userExists(email, checkingAlias = null) {
  const conditions = [];

  if (email) {
    const targetNormalizedEmail = canonicalizeEmail(email);
    conditions.push({ normalizedEmail: targetNormalizedEmail });
    conditions.push({ newEmailPending: email.trim() });
  }

  if (checkingAlias) {
    conditions.push({ alias: checkingAlias.trim().toLowerCase() });
  }

  if (conditions.length === 0) return false;

  const exists = await User.exists({ $or: conditions });
  return exists !== null;
}

// ZMIANA: Usunięto helper aliasExists i zastąpiono go metodą sprawdzania wewnątrz kolekcji User
async function aliasExists(alias, currentUserId = null) {
  if (!alias || typeof alias !== "string") return false;
  const { RESERVED_ALIASES } = require("../config");
  const cleanAlias = alias.trim().toLowerCase();

  if (RESERVED_ALIASES.includes(cleanAlias)) return true;

  const query = { alias: cleanAlias };
  if (currentUserId) {
    query._id = { $ne: currentUserId };
  }

  const exists = await User.exists(query);
  return exists !== null;
}

async function addUser(name, email, password = null) {
  if (!name || typeof name !== "string" || name.trim().length < 3) {
    return {
      error: true,
      message: "Imię i Nazwisko / Pseudonim musi mieć minimum 3 znaki.",
    };
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return {
      error: true,
      message: "Wprowadź poprawny i kompletny adres e-mail.",
    };
  }

  try {
    const cleanEmail = email.trim();
    if (await userExists(cleanEmail)) {
      return {
        error: true,
        message:
          "Podany adres e-mail jest już zajęty przez innego użytkownika.",
      };
    }

    const targetNormalizedEmail = canonicalizeEmail(cleanEmail);
    if (!password) password = crypto.randomBytes(32).toString("hex");
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = new User({
      name: name.trim(),
      email: cleanEmail,
      normalizedEmail: targetNormalizedEmail,
      password: hashedPassword,
      isVerified: false,
      verificationTransferStatus: "pending_submission",
      allowPrivateEmails: false,
      token: 24,
    });

    return await newUser.save();
  } catch (err) {
    if (err.code === 11000) {
      return {
        error: true,
        message:
          "Podany adres e-mail jest już zajęty przez innego użytkownika.",
      };
    }
    console.error("Krytyczny błąd addUser():", err);
    return {
      error: true,
      message: "Wystąpił błąd bazy danych podczas tworzenia profilu.",
    };
  }
}

// tools/user.js

async function createVerifiedUser(userData) {
  const { name, email, alias, avatarUrl, coverUrl, password, role, allowPrivateEmails, bio } = userData;
  const cleanAlias = alias?.trim().toLowerCase();

  try {
    // Sprawdzamy dostępność aliasu bezpośrednio w kolekcji użytkowników
    if (cleanAlias && (await aliasExists(cleanAlias))) {
      return {
        error: true,
        message: `Błąd: Alias '${cleanAlias}' jest niedozwolony lub zajęty.`,
      };
    }

    // Wywołujemy addUser, aby utworzyć podstawowy szkielet dokumentu
    const dbUser = await addUser(name, email, password);
    if (dbUser.error) return dbUser;

    // PRZEKAZYWANIE ROLI: Jeśli rola została zdefiniowana w konfiguracji (np. "editor"), 
    // przypisujemy ją. W innym przypadku Mongoose użyje domyślnej wartości ("user").
    if (role) {
      dbUser.role = role;
    }

    dbUser.isVerified = true;
    dbUser.verificationTransferStatus = "approved";
    dbUser.verificationTransferCode = "AUTO-VERIFIED-SYSTEM";
    dbUser.verificationBankAccount = crypto
      .createHash("sha256")
      .update(`AUTO-ACCOUNT-${cleanAlias || "default"}`)
      .digest("hex");

    // DYNAMICZNA ZGODA NA E-MAILE: Przypisujemy wartość z konfiguracji (true/false).
    // Jeśli nie podano w obiekcie, domyślnie ustawiamy true dla kont systemowych (stary fallback).
    dbUser.allowPrivateEmails = typeof allowPrivateEmails !== "undefined" ? allowPrivateEmails : true;
    
    dbUser.bio = typeof bio !== "undefined" ? bio : '';

    dbUser.securityToken = undefined;
    dbUser.securityTokenExpires = undefined;

    // Zapisujemy alias bezpośrednio w dokumencie użytkownika
    if (cleanAlias) dbUser.alias = cleanAlias;

    if (avatarUrl) dbUser.avatarUrl = avatarUrl;
    if (coverUrl) dbUser.coverUrl = coverUrl;

    const savedUser = await dbUser.save();
    return savedUser;
  } catch (err) {
    console.error("Krytyczny błąd createVerifiedUser():", err);
    return {
      error: true,
      message:
        "Krytyczny błąd systemu podczas automatycznej weryfikacji konta.",
    };
  }
}

/**
 * Trwale i kaskadowo usuwa użytkownika o zadanym ID wraz ze wszystkimi powiązanymi zasobami:
 * - zdjęciami profilowymi (avatar, cover) i grafikami jego artykułów z dysku serwera,
 * - wpisami z mediów społecznościowych (Facebook, Fediversum, Bluesky, X),
 * - postami, zgłoszeniami, powiadomieniami, komentarzami, polubieniami oraz relacjami follow/block.
 */
async function rmUser(id, req = null) {
  if (!id || !ObjectId.isValid(id)) {
    return { error: true, message: "Nieprawidłowy identyfikator użytkownika." };
  }

  try {
    const user = await User.findById(id);
    if (!user) {
      return { error: true, message: "Nie odnaleziono użytkownika w bazie danych." };
    }

    const userId = user._id;
    const fsPromises = require("fs").promises;
    const path = require("path");
    const uploadDir = path.resolve(__dirname, DEFAULT_ASSETS.uploads);

    const safeUnlink = async (relativeUrl, defaultFile) => {
      if (!relativeUrl || (defaultFile && relativeUrl.includes(defaultFile))) return;
      const targetPath = path.resolve(uploadDir, path.basename(relativeUrl));
      if (targetPath.startsWith(uploadDir)) {
        try {
          await fsPromises.unlink(targetPath);
        } catch (e) {
          if (e.code !== "ENOENT") {
            console.error(`[rmUser] Błąd usuwania pliku ${targetPath}:`, e);
          }
        }
      }
    };

    // 1. Usunięcie zdjęć profilowych użytkownika z dysku
    await safeUnlink(user.avatarUrl, DEFAULT_ASSETS.avatar);
    await safeUnlink(user.coverUrl, DEFAULT_ASSETS.cover);

    // 2. Pobranie wszystkich postów użytkownika (wraz z grafikami i identyfikatorami social media)
    const Post = mongoose.model("Post");
    const Notification = mongoose.model("Notification");

    const userPosts = await Post.find({ authorId: userId }).select(
      "_id title imageUrl fbPostId fediPostId bskyPostUri xPostId"
    );
    const userPostIds = userPosts.map((p) => p._id);

    // 3. Usunięcie grafik z artykułów użytkownika oraz wpisów z mediów społecznościowych
    const { deleteFromAllSocials } = require("./socialPublisher");
    for (const postDoc of userPosts) {
      if (postDoc.imageUrl) {
        await safeUnlink(postDoc.imageUrl, null);
      }
    }

    const socialPosts = userPosts.filter(
      (p) => p.fbPostId || p.fediPostId || p.bskyPostUri || p.xPostId
    );
    if (socialPosts.length > 0 && req) {
      await Promise.allSettled(
        socialPosts.map((postDoc) => deleteFromAllSocials(postDoc, req))
      );
    }

    // 4. Kaskadowe czyszczenie powiadomień, postów, komentarzy i relacji w MongoDB
    await Notification.deleteMany({
      $or: [
        { senderId: userId },
        { recipientId: userId },
        { postId: { $in: userPostIds } },
      ],
    });

    await Post.deleteMany({
      $or: [
        { authorId: userId },
        { parentPostId: { $in: userPostIds }, isAbuseReport: true },
        { parentPostId: { $in: userPostIds }, isFactCheckReport: true },
      ],
    });

    // Odpięcie polemik innych autorów od skasowanych artykułów
    await Post.updateMany(
      {
        parentPostId: { $in: userPostIds },
        isAbuseReport: false,
        isFactCheckReport: { $ne: true },
      },
      { $set: { parentPostId: null } }
    );

    // Usunięcie komentarzy oraz polubień autora w postach innych użytkowników
    await Post.updateMany(
      {},
      {
        $pull: {
          comments: { authorId: userId },
          likedBy: String(userId),
        },
      }
    );

    // Usunięcie ID użytkownika z list following i blocks innych użytkowników
    await User.updateMany(
      {},
      {
        $pull: {
          following: userId,
          blocks: userId,
        },
      }
    );

    // 5. Usunięcie głównego dokumentu użytkownika
    await User.findByIdAndDelete(userId);

    return {
      success: true,
      deletedUser: {
        _id: userId,
        name: user.name,
        email: user.email,
      },
    };
  } catch (err) {
    console.error(`[rmUser CRITICAL] Błąd usuwania użytkownika ${id}:`, err);
    return {
      error: true,
      message: "Wystąpił błąd krytyczny podczas kaskadowego usuwania konta.",
    };
  }
}

module.exports = {
  User,
  canonicalizeEmail,
  userExists,
  aliasExists,
  addUser,
  rmUser,
  createVerifiedUser,
};
