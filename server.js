const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config(); 

const app = express();
const server = http.createServer(app);

const clientUrl = process.env.CLIENT_URL;
const port = process.env.PORT;

const io = new Server(server, {
  cors: {
    origin: clientUrl,
    methods: ["GET", "POST"],
  },
});

app.use(cors());

let users = [];

function handleUsername(socket, username, callback) {
  if (!username || username.trim() === "") {
    socket.emit("message", {
      type: "system",
      text: "Lütfen geçerli bir kullanıcı adı belirleyin!",
    });
    return;
  }
  socket.username = username;
  callback();
}

io.on("connection", (socket) => {
  console.log("Bir kullanıcı bağlandı!");

  socket.on("join", (username) => {
    handleUsername(socket, username, () => {
      users.push({ id: socket.id, username });

      socket.emit("userId", socket.id);

      io.emit(
        "onlineUsers",
        users.map((user) => user.username)
      );

      io.emit("message", { type: "system", text: `${username} katıldı!` });
    });
  });

  socket.on("chatMessage", (msg) => {
    handleUsername(socket, socket.username, () => {
      io.emit("message", {
        user: { id: socket.id, username: socket.username },
        text: msg,
      });
    });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      users = users.filter((user) => user.id !== socket.id);

      io.emit(
        "onlineUsers",
        users.map((user) => user.username)
      );

      io.emit("message", {
        type: "system",
        text: `${socket.username} ayrıldı.`,
      });
    }
  });
});

server.listen(port, () =>
  console.log(`✅ Sunucu ${port} portunda çalışıyor...`)
);
