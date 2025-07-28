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
// Oda bazlı mesajları saklamak için
let roomMessages = {};
let roomPinnedMessage = {};

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
      // Oda mesajları başlat
      if (!roomMessages[normalizedRoom]) roomMessages[normalizedRoom] = [];
      socket.emit("userId", socket.id);
      // Sadece odaya online kullanıcıları gönder
      io.to(normalizedRoom).emit(
        "onlineUsers",
        rooms[normalizedRoom].map((user) => user.username)
      );
      // id-isim eşleşmesi de gönder
      io.to(normalizedRoom).emit(
        "onlineUsersWithIds",
        rooms[normalizedRoom]
      );
      io.to(normalizedRoom).emit("message", { type: "system", text: `${username} katıldı!` });
      // Odaya mevcut mesajları gönder
      socket.emit("allMessages", roomMessages[normalizedRoom]);
      // Sabitli mesajı gönder
      socket.emit("pinnedMessage", roomPinnedMessage[normalizedRoom] || null);
    });
  });

  socket.on("chatMessage", (msg) => {
    handleUsername(socket, socket.username, () => {
      const room = socket.room;
      if (room) {
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
        const messageObj = {
          user: { id: socket.id, username: socket.username },
          text: msg,
          time,
          id: `${socket.id}-${Date.now()}`,
          readBy: [socket.id] // Mesajı gönderen otomatik okumuş olur
        };
        if (!roomMessages[room]) roomMessages[room] = [];
        roomMessages[room].push(messageObj);
        io.to(room).emit("message", messageObj);
      }
    });
  });

  // Okundu bilgisi event'i
  socket.on("messageRead", ({ room, messageId, userId }) => {
    if (roomMessages[room]) {
      const msg = roomMessages[room].find((m) => m.id === messageId);
      if (msg && !msg.readBy?.includes(userId)) {
        msg.readBy = msg.readBy || [];
        msg.readBy.push(userId);
        io.to(room).emit("messageReadUpdate", { messageId, userId });
      }
    }
  });

  // Mesaj silme event'i
  socket.on("deleteMessage", ({ room, messageId }) => {
    if (roomMessages[room]) {
      roomMessages[room] = roomMessages[room].filter((msg) => msg.id !== messageId);
      // Güncel mesaj listesini odaya yayınla
      io.to(room).emit("allMessages", roomMessages[room]);
    }
  });

  // Mesaj sabitleme
  socket.on("pinMessage", ({ room, messageId }) => {
    if (roomMessages[room]) {
      const msg = roomMessages[room].find((m) => m.id === messageId);
      if (msg) {
        roomPinnedMessage[room] = msg;
        io.to(room).emit("pinnedMessage", msg);
      }
    }
  });

  // Sabitli mesajı kaldırma
  socket.on("unpinMessage", ({ room }) => {
    if (roomPinnedMessage[room]) {
      roomPinnedMessage[room] = null;
      io.to(room).emit("pinnedMessage", null);
    }
  });

  socket.on("disconnect", () => {
    const room = socket.room;
    if (socket.username && room && rooms[room]) {
      rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
      io.to(room).emit(
        "onlineUsers",
        rooms[room].map((user) => user.username)
      );
      io.to(room).emit(
        "onlineUsersWithIds",
        rooms[room]
      );
      io.to(room).emit("message", {
        type: "system",
        text: `${socket.username} ayrıldı.`,
      });
      // Oda boşsa sil
      if (rooms[room].length === 0) {
        delete rooms[room];
        delete roomMessages[room];
        delete roomPinnedMessage[room];
      }
    }
  });
});

server.listen(port, () =>
  console.log(`✅ Sunucu ${port} portunda çalışıyor...`)
);