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
    required: true,
  },
  type: {
    type: String,
    enum: ["like_post", "comment_post", "reply_comment", "follow"],
    required: true,
  },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
  commentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, default: Date.now },
});

const Notification = mongoose.model("Notification", notificationSchema);

async function createNotification({
  senderId,
  recipientId,
  type,
  postId = null,
  commentId = null,
}) {
  try {
    if (senderId.toString() === recipientId.toString()) return;
    if (type === "like_post" || type === "follow") {
      const exists = await Notification.findOne({
        senderId,
        recipientId,
        type,
        postId,
      });
      if (exists) return;
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
