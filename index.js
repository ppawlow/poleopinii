// index.js
const http = require("http");
const app = require("./app");
const { PORT, SYSTEM_USERS } = require("./config");
const { createVerifiedUser } = require("./tools/db");
const { startNotification } = require("./tools/mailer");
const { initWebSocket } = require("./tools/ws");

const server = http.createServer(app);
// Inicjalizacja serwera WebSocket oraz rejestracja lokalnych funkcji na app i req.ws
initWebSocket(server);

const PORT_APP = PORT || process.env.PORT || 3000;
server.listen(PORT_APP, async () => {
  if (SYSTEM_USERS && Array.isArray(SYSTEM_USERS)) {
    for (const sysUser of SYSTEM_USERS) await createVerifiedUser(sysUser);
  }

  console.log(`Aplikacja i serwer WebSocket nasłuchują na porcie ${PORT_APP}`);
  startNotification();
  const { initializeNewsCron } = require("./tools/aiNewsService");
  initializeNewsCron();
});
