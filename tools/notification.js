// tools/notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null, // null dla globalnych komunikatów systemowych (announcement)
  },
  type: {
    type: String,
    enum: ["like_post", "comment_post", "reply_comment", "follow", "reply_post", "announcement"],
    required: true,
  },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
  commentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 30 * 24 * 60 * 60, // Automatyczne czyszczenie po 30 dniach
  },
});

const Notification = mongoose.model("Notification", notificationSchema);

async function createNotification({
  senderId,
  recipientId = null,
  type,
  postId = null,
  commentId = null,
}) {
  try {
    if (type !== "announcement") {
      if (!recipientId || senderId.toString() === recipientId.toString()) return;
      if (type === "like_post" || type === "follow") {
        const exists = await Notification.findOne({
          senderId,
          recipientId,
          type,
          postId,
        });
        if (exists) return;
      }
    }

    await Notification.create({
      senderId,
      recipientId,
      type,
      postId,
      commentId,
    });
  } catch (err) {
    console.error("Błąd zapisu powiadomienia:", err);
  }
}

module.exports = { Notification, createNotification };
