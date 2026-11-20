// tools/ws.js
const WebSocket = require("ws");
const cookieParser = require("cookie-parser");
const MongoStore = require("connect-mongo").default;
const { User } = require("./db");

// Współdzielony kontener lokalnych funkcji nadawczych wstrzykiwany do req.ws
const wsHandlers = {
  broadcastPost: () => {},
  broadcastComment: () => {},
  broadcastCommentDeleted: () => {},
  broadcastCommentEdited: () => {},
  sendNotification: () => {},
  broadcastAnnouncement: () => {},
};

// Middleware podpinany w app.js przed routerami
function attachWsMiddleware(req, res, next) {
  req.ws = wsHandlers;
  next();
}

// Inicjalizacja serwera WebSocket wywoływana w index.js
function initWebSocket(server) {
  const sessionStore = MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/test",
  });

  const wss = new WebSocket.Server({ noServer: true });
  const activeConnections = new Set();

  server.on("upgrade", (request, socket, head) => {
    cookieParser(process.env.SESSION_SECRET)(request, {}, () => {
      const sid = request.signedCookies
        ? request.signedCookies["connect.sid"]
        : null;

      if (!sid) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      sessionStore.get(sid, async (err, sessionData) => {
        if (err || !sessionData || !sessionData.user || !sessionData.user.id) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const userDoc = await User.findById(sessionData.user.id).select(
          "role following blocks",
        );
        if (!userDoc) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const reqUrl = new URL(request.url, `http://${request.headers.host}`);
        const currentPath = reqUrl.searchParams.get("path") || "/";

        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.userId = userDoc._id.toString();
          ws.role = userDoc.role;
          ws.following = (userDoc.following || []).map((id) => id.toString());
          ws.blocks = (userDoc.blocks || []).map((id) => id.toString());
          ws.currentPath = currentPath;
          wss.emit("connection", ws, request);
        });
      });
    });
  });

  wss.on("connection", (ws) => {
    activeConnections.add(ws);
    console.log(
      `[WebSocket] Użytkownik połączył się ze strumieniem na żywo. (Aktywnych: ${activeConnections.size})`,
    );

    ws.on("close", () => {
      activeConnections.delete(ws);
      console.log(
        `[WebSocket] Użytkownik rozłączył się ze strumieniem. (Aktywnych: ${activeConnections.size})`,
      );
    });
  });

  // Lokalne funkcje obsługujące transmisję
  function broadcastPost({ html, post, authorBlocks = [] }) {
    if (!post || post.visibility === "private") return;

    const authorIdStr = post.authorId.toString();
    const payload = JSON.stringify({
      type: "NEW_POST",
      html,
      visibility: post.visibility,
      authorId: authorIdStr,
    });

    activeConnections.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.userId === authorIdStr) return;

      if (authorBlocks.includes(client.userId)) return;
      if (client.blocks.includes(authorIdStr)) return;

      if (post.visibility === "editors") {
        if (client.role !== "editor" || client.currentPath !== "/editors") return;
      } else if (post.visibility === "restricted") {
        if (!client.following.includes(authorIdStr)) return;
        if (client.currentPath === "/editors") return;
      } else if (post.visibility === "public" || post.visibility === "users") {
        if (client.currentPath === "/editors") return;
      }
      client.send(payload);
    });
  }

  function broadcastComment({
    html,
    postId,
    visibility,
    postAuthorId,
    senderId,
    authorBlocks = [],
  }) {
    const senderIdStr = senderId.toString();
    const postAuthorIdStr = postAuthorId.toString();
    const payload = JSON.stringify({
      type: "NEW_COMMENT",
      html,
      postId: postId.toString(),
      senderId: senderIdStr,
    });

    activeConnections.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.userId === senderIdStr) return;

      if (visibility === "editors") {
        if (client.role !== "editor" || client.currentPath !== "/editors") return;
      } else {
        if (authorBlocks.includes(client.userId)) return;
        if (client.blocks.includes(senderIdStr)) return;
        if (client.blocks.includes(postAuthorIdStr)) return;
      }

      client.send(payload);
    });
  }

  function broadcastCommentDeleted({ postId, commentId }) {
    const payload = JSON.stringify({
      type: "DELETE_COMMENT",
      postId: postId.toString(),
      commentId: commentId.toString(),
    });

    activeConnections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  function broadcastCommentEdited({ postId, commentId, content }) {
    const payload = JSON.stringify({
      type: "EDIT_COMMENT",
      postId: postId.toString(),
      commentId: commentId.toString(),
      content,
    });

    activeConnections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  function sendNotification(recipientId, notificationData) {
    if (!recipientId) return;
    const targetIdStr = recipientId.toString();
    const payload = JSON.stringify({
      type: "NEW_NOTIFICATION",
      ...notificationData,
    });

    activeConnections.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.userId === targetIdStr
      ) {
        client.send(payload);
      }
    });
  }

  function broadcastAnnouncement(notificationData) {
    const payload = JSON.stringify({
      type: "NEW_NOTIFICATION",
      ...notificationData,
    });

    activeConnections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  // Podpięcie lokalnych funkcji do współdzielonego obiektu req.ws
  Object.assign(wsHandlers, {
    broadcastPost,
    broadcastComment,
    broadcastCommentDeleted,
    broadcastCommentEdited,
    sendNotification,
    broadcastAnnouncement,
  });
}

module.exports = { initWebSocket, attachWsMiddleware };
