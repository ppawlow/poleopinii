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
});

userSchema.virtual("isFullyVerified").get(function () {
  return (
    this.isVerified === true && this.verificationTransferStatus === "approved"
  );
});

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
    console.error("Krytyczny błąd addUser():", err);
    return {
      error: true,
      message: "Wystąpił błąd bazy danych podczas tworzenia profilu.",
    };
  }
}

async function createVerifiedUser(userData) {
  const { name, email, alias, avatarUrl, coverUrl, password } = userData;
  const cleanAlias = alias?.trim().toLowerCase();

  try {
    // Sprawdzamy dostępność aliasu bezpośrednio w kolekcji użytkowników
    if (cleanAlias && (await aliasExists(cleanAlias))) {
      return {
        error: true,
        message: `Błąd: Alias '${cleanAlias}' jest niedozwolony lub zajęty.`,
      };
    }

    const dbUser = await addUser(name, email, password);
    if (dbUser.error) return dbUser;

    dbUser.isVerified = true;
    dbUser.verificationTransferStatus = "approved";
    dbUser.verificationTransferCode = "AUTO-VERIFIED-SYSTEM";
    dbUser.verificationBankAccount = crypto
      .createHash("sha256")
      .update(`AUTO-ACCOUNT-${cleanAlias || "default"}`)
      .digest("hex");
    dbUser.allowPrivateEmails = true;
    dbUser.securityToken = undefined;
    dbUser.securityTokenExpires = undefined;

    // ZAPISUJEMY ALIAS BEZPOŚREDNIO W DOKUMENCIE UŻYTKOWNIKA
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

module.exports = {
  User,
  canonicalizeEmail,
  userExists,
  aliasExists,
  addUser,
  createVerifiedUser,
};
