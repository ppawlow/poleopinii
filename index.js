// index.js
const http = require("http");
const WebSocket = require("ws");
const cookieParser = require("cookie-parser");
const MongoStore = require("connect-mongo").default;
const app = require("./app");
const { PORT, SYSTEM_USERS } = require("./config");
const { User, createVerifiedUser } = require("./tools/db");
const { startNotification } = require("./tools/mailer");

// Tworzymy serwer HTTP owijający aplikację Express
const server = http.createServer(app);

// Wspólny store sesji (wyniesiony poza upgrade dla optymalizacji wydajności)
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/test",
});

// Inicjalizacja serwera WebSocket
const wss = new WebSocket.Server({ noServer: true });

// Globalny zbiór wszystkich aktywnych połączeń zalogowanych użytkowników
const activeConnections = new Set();

// Obsługa bezpiecznego upgrade protokołu HTTP -> WS z weryfikacją sesji Expressa
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

      // Weryfikujemy istnienie użytkownika i pobieramy jego aktualne uprawnienia oraz relacje
      const userDoc = await User.findById(sessionData.user.id).select(
        "role following blocks",
      );
      if (!userDoc) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Odczyt aktualnej ścieżki z parametrów URL połączenia (np. /?path=/editors)
      const reqUrl = new URL(request.url, `http://${request.headers.host}`);
      const currentPath = reqUrl.searchParams.get("path") || "/";

      // Pozytywna autoryzacja - dokonujemy upgrade połączenia
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

// Zarządzanie cyklem życia połączeń WebSocket
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

// 1. Rozsyłanie nowych postów z weryfikacją uprawnień, widoczności i blokad
app.set("wsBroadcastPost", ({ html, post, authorBlocks = [] }) => {
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
    if (client.userId === authorIdStr) return; // Nie wysyłamy autorowi jego własnego posta

    // Weryfikacja wzajemnych blokad
    if (authorBlocks.includes(client.userId)) return;
    if (client.blocks.includes(authorIdStr)) return;

    // Weryfikacja strefy widoczności i ścieżki odbiorcy
    if (post.visibility === "editors") {
      if (client.role !== "editor" || client.currentPath !== "/editors") return;
    } else if (post.visibility === "restricted") {
      if (!client.following.includes(authorIdStr)) return;
      if (client.currentPath === "/editors") return;
    } else if (post.visibility === "public") {
      if (client.currentPath === "/editors") return;
    }

    client.send(payload);
  });
});

// 2. Rozsyłanie nowych komentarzy z weryfikacją blokad i uprawnień
app.set(
  "wsBroadcastComment",
  ({ html, postId, visibility, postAuthorId, senderId, authorBlocks = [] }) => {
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
  },
);

// 3. Wysyłanie powiadomienia w czasie rzeczywistym do konkretnego odbiorcy
app.set("wsSendNotification", (recipientId, notificationData) => {
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
});

// Uruchomienie infrastruktury serwerowej
const PORT_APP = PORT || process.env.PORT || 3000;
server.listen(PORT_APP, async () => {
  if (SYSTEM_USERS && Array.isArray(SYSTEM_USERS))
    for (const sysUser of SYSTEM_USERS) await createVerifiedUser(sysUser);

  console.log(`Aplikacja i serwer WebSocket nasłuchują na porcie ${PORT_APP}`);
  startNotification();
  const { initializeNewsCron } = require("./tools/aiNewsService");
  initializeNewsCron();
});
