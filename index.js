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

// Inicjalizacja serwera WebSocket
const wss = new WebSocket.Server({ noServer: true });

// Globalna mapa aktywnych połączeń WebSocket redaktorów
const editorConnections = new Set();

// Obsługa bezpiecznego upgrade protokołu HTTP -> WS z weryfikacją sesji Expressa
server.on("upgrade", (request, socket, head) => {
  cookieParser(process.env.SESSION_SECRET)(request, {}, () => {
    const sessionStore = MongoStore.create({ 
      mongoUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/test" 
    });
    
    const sid = request.signedCookies ? request.signedCookies["connect.sid"] : null;
    
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

      // Sprawdzamy rolę użytkownika bezpośrednio w kolekcji DB przed przyznaniem dostępu do socketu
      const userDoc = await User.findById(sessionData.user.id);
      if (!userDoc || userDoc.role !== "editor") {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      // Pozytywna autoryzacja - dokonujemy upgrade połączenia
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.userId = userDoc._id.toString();
        wss.emit("connection", ws, request);
      });
    });
  });
});

// Zarządzanie cyklem życia socketów redakcyjnych
wss.on("connection", (ws) => {
  editorConnections.add(ws);
  console.log(`[WebSocket] Redaktor dołączył do kanału narad w czasie rzeczywistym. (Aktywnych: ${editorConnections.size})`);

  ws.on("close", () => {
    editorConnections.delete(ws);
    console.log(`[WebSocket] Redaktor opuścił kanał narad. (Aktywnych: ${editorConnections.size})`);
  });
});

// Rejestrujemy funkcję nadawczą w kontekście aplikacji Express, by była łatwo dostępna w routerach
app.set("wsBroadcastEditorPost", (htmlSnippet, senderId) => {
  const payload = JSON.stringify({ type: "NEW_EDITOR_POST", html: htmlSnippet, senderId });
  editorConnections.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId !== senderId.toString()) {
      client.send(payload);
    }
  });
});

app.set("wsBroadcastEditorComment", (htmlSnippet, postId, senderId) => {
  const payload = JSON.stringify({ 
    type: "NEW_EDITOR_COMMENT", 
    html: htmlSnippet, 
    postId: postId.toString(),
    senderId: senderId.toString() 
  });
  
  editorConnections.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId !== senderId.toString()) {
      client.send(payload);
    }
  });
});

// Uruchomienie infrastruktury serwerowej
const PORT_APP = PORT || process.env.PORT || 3000;
server.listen(PORT_APP, async () => {
  
  if (SYSTEM_USERS && Array.isArray(SYSTEM_USERS))
    for (const sysUser of SYSTEM_USERS)
      await createVerifiedUser(sysUser);

  console.log(`Aplikacja i serwer WebSocket nasłuchują na porcie ${PORT_APP}`);
  startNotification();
  const { initializeNewsCron } = require("./tools/aiNewsService");
  initializeNewsCron();
});
