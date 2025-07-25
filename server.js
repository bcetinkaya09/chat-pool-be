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

let rooms = {};

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

  socket.on("getRooms", () => {
    socket.emit("roomsList", Object.keys(rooms)); // We'll update this after normalizing room names
  });

  socket.on("joinRoom", ({ username, room }) => {
    const normalizedRoom = room.toLowerCase();
    handleUsername(socket, username, () => {
      socket.join(normalizedRoom);
      socket.room = normalizedRoom;
      // Odaya kullanıcı ekle
      if (!rooms[normalizedRoom]) rooms[normalizedRoom] = [];
      rooms[normalizedRoom].push({ id: socket.id, username });

      socket.emit("userId", socket.id);
      // Sadece odaya online kullanıcıları gönder
      io.to(normalizedRoom).emit(
        "onlineUsers",
        rooms[normalizedRoom].map((user) => user.username)
      );
      io.to(normalizedRoom).emit("message", { type: "system", text: `${username} katıldı!` });
    });
  });

  socket.on("chatMessage", (msg) => {
    handleUsername(socket, socket.username, () => {
      const room = socket.room;
      if (room) {
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        io.to(room).emit("message", {
          user: { id: socket.id, username: socket.username },
          text: msg,
          time, // saat:dakika
        });
      }
    });
  });

  socket.on("disconnect", () => {
    const room = socket.room;
    if (socket.username && room && rooms[room]) {
      rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
      io.to(room).emit(
        "onlineUsers",
        rooms[room].map((user) => user.username)
      );
      io.to(room).emit("message", {
        type: "system",
        text: `${socket.username} ayrıldı.`,
      });
      // Oda boşsa sil
      if (rooms[room].length === 0) {
        delete rooms[room];
      }
    }
  });
});

server.listen(port, () =>
  console.log(`✅ Sunucu ${port} portunda çalışıyor...`)
);
