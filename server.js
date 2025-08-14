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
// Oda bazlı görünüm ayarları (tema ve arka plan rengi)
let roomAppearance = {};
// Oda bazlı aktif anket durumu
let roomActivePoll = {};
// Otomatik bitiş için zamanlayıcılar
let roomPollTimers = {};

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
      // İlk giren admin olsun
      const isFirstUser = rooms[normalizedRoom].length === 0;
      rooms[normalizedRoom].push({ id: socket.id, username, isAdmin: isFirstUser });
      // Eğer admin yoksa güvence için ilk kullanıcıyı admin yap
      if (!rooms[normalizedRoom].some((u) => u.isAdmin) && rooms[normalizedRoom].length > 0) {
        rooms[normalizedRoom][0].isAdmin = true;
      }
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
      // Oda görünüm ayarlarını gönder (yoksa varsayılan)
      if (!roomAppearance[normalizedRoom]) {
        roomAppearance[normalizedRoom] = { theme: "dark", backgroundColor: null };
      }
      socket.emit("roomAppearance", roomAppearance[normalizedRoom]);
      // Aktif anketi gönder
      socket.emit("activePoll", roomActivePoll[normalizedRoom] || null);
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
          readBy: [socket.id], // Mesajı gönderen otomatik okumuş olur
          createdAt: Date.now() // Ek zaman damgası
        };
        if (!roomMessages[room]) roomMessages[room] = [];
        roomMessages[room].push(messageObj);
        io.to(room).emit("message", messageObj);
        // Mention kontrolü
        const mentionRegex = /@([\wçğıöşüÇĞİÖŞÜ]+)/gi;
        let match;
        const notified = new Set();
        while ((match = mentionRegex.exec(msg))) {
          const mentioned = match[1];
          // Oda kullanıcıları arasında var mı?
          const userObj = rooms[room]?.find(u => u.username === mentioned);
          if (userObj && userObj.id !== socket.id && !notified.has(userObj.id)) {
            io.to(userObj.id).emit("mentionNotify", { text: `@${mentioned} olarak bir mesajda etiketlendiniz!` });
            notified.add(userObj.id);
          }
        }
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
      const messageIndex = roomMessages[room].findIndex((msg) => msg.id === messageId);
      if (messageIndex !== -1) {
        const message = roomMessages[room][messageIndex];
        
        // Admin kontrolü
        const currentRoom = room?.toLowerCase?.() || socket.room;
        const usersInRoom = rooms[currentRoom] || [];
        const requester = usersInRoom.find((u) => u.id === socket.id);
        const isAdmin = requester && requester.isAdmin;
        
        // Mesaj sahibi veya admin silebilir
        if (message.user.id === socket.id || isAdmin) {
          roomMessages[room].splice(messageIndex, 1);
          // Güncel mesaj listesini odaya yayınla
          io.to(room).emit("allMessages", roomMessages[room]);
          
          // Admin başka birinin mesajını sildiyse bilgilendirme gönder
          if (isAdmin && message.user.id !== socket.id) {
            io.to(room).emit("message", { 
              type: "system", 
              text: `${requester.username} tarafından ${message.user.username} kullanıcısının mesajı silindi.`,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
            });
          }
        }
      }
    }
  });

  // Mesaj düzenleme event'i
  socket.on("editMessage", ({ room, messageId, newText }) => {
    if (roomMessages[room]) {
      const message = roomMessages[room].find((msg) => msg.id === messageId);
      if (message && message.user.id === socket.id) {
        // Mesajın gönderilme zamanını kontrol et (1 dakika = 60000 ms)
        const messageTime = message.createdAt || parseInt(message.id.split('-')[1]);
        const currentTime = Date.now();
        const timeDifference = currentTime - messageTime;
        
        console.log(`Mesaj zamanı: ${messageTime}, Şu anki zaman: ${currentTime}, Fark: ${timeDifference}ms`);
        
        if (timeDifference <= 300000) { // 5 dakika içinde (test için)
          message.text = newText;
          message.edited = true;
          message.editTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
          // Güncel mesaj listesini odaya yayınla
          io.to(room).emit("allMessages", roomMessages[room]);
        } else {
          // Zaman aşımı durumunda kullanıcıya hata mesajı gönder
          socket.emit("editError", { message: `Mesajı düzenlemek için çok geç! Sadece 1 dakika içinde düzenleyebilirsiniz. (Geçen süre: ${Math.floor(timeDifference/1000)} saniye)` });
        }
      }
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

  // Oda görünüm ayarlarını güncelle (yalnızca admin)
  socket.on("updateRoomAppearance", ({ room, theme, backgroundColor }) => {
    const currentRoom = room?.toLowerCase?.() || socket.room;
    if (!currentRoom || !rooms[currentRoom]) return;
    const usersInRoom = rooms[currentRoom];
    const requester = usersInRoom.find((u) => u.id === socket.id);
    if (!requester || !requester.isAdmin) {
      socket.emit("actionError", { type: "appearance", message: "Bu işlem için yetkiniz yok." });
      return;
    }
    // Geçerli değerleri yaz
    const next = {
      theme: theme === "light" ? "light" : "dark",
      backgroundColor: backgroundColor || null,
    };
    roomAppearance[currentRoom] = next;
    io.to(currentRoom).emit("roomAppearance", next);
  });

  // Kullanıcı yazıyor event'i
  socket.on("typing", ({ room, username }) => {
    if (room && username) {
      socket.to(room).emit("typing", { username });
    }
  });

  // Kullanıcı yazmayı bıraktı event'i
  socket.on("stopTyping", ({ room, username }) => {
    if (room && username) {
      socket.to(room).emit("stopTyping", { username });
    }
  });

  // Admin: kullanıcıyı gruptan atma
  socket.on("kickUser", ({ room, targetUserId }) => {
    const currentRoom = room?.toLowerCase?.() || socket.room;
    if (!currentRoom || !rooms[currentRoom]) return;
    const usersInRoom = rooms[currentRoom];
    const requester = usersInRoom.find((u) => u.id === socket.id);
    if (!requester || !requester.isAdmin) {
      // Yetkisiz istekleri sessizce yok say ya da istersen hata yolla
      socket.emit("actionError", { type: "kick", message: "Bu işlem için yetkiniz yok." });
      return;
    }
    if (targetUserId === socket.id) {
      socket.emit("actionError", { type: "kick", message: "Kendinizi atamazsınız." });
      return;
    }
    const targetIndex = usersInRoom.findIndex((u) => u.id === targetUserId);
    if (targetIndex === -1) return;

    // Oda listesinden çıkar
    const [kickedUser] = usersInRoom.splice(targetIndex, 1);

    // Socket'i odadan çıkar
    const targetSocket = io.sockets.sockets.get(targetUserId);
    if (targetSocket) {
      try {
        targetSocket.leave(currentRoom);
        if (targetSocket.room === currentRoom) {
          targetSocket.room = null;
        }
        io.to(targetUserId).emit("kicked", { room: currentRoom, by: requester.username });
      } catch (e) {
        // ignore
      }
    }

    if (usersInRoom.length === 0) {
      // Oda boşsa sil ve çık
      delete rooms[currentRoom];
      delete roomMessages[currentRoom];
      delete roomPinnedMessage[currentRoom];
      delete roomAppearance[currentRoom];
    } else {
      // Eğer odada admin kalmadıysa ilk kişiyi admin yap
      if (!usersInRoom.some((u) => u.isAdmin)) {
        usersInRoom[0].isAdmin = true;
        io.to(currentRoom).emit("message", { type: "system", text: `${usersInRoom[0].username} yeni admin oldu.` });
      }

      // Güncel listeleri ve bilgilendirmeleri yayınla
      io.to(currentRoom).emit(
        "onlineUsers",
        usersInRoom.map((user) => user.username)
      );
      io.to(currentRoom).emit("onlineUsersWithIds", usersInRoom);
      io.to(currentRoom).emit("message", { type: "system", text: `${kickedUser.username} odadan atıldı.` });
    }
  });

  // Anket başlat (yalnızca admin)
  socket.on("startPoll", ({ room, question, options, multiple = false, durationSec = null }) => {
    const currentRoom = room?.toLowerCase?.() || socket.room;
    if (!currentRoom || !rooms[currentRoom]) return;
    const usersInRoom = rooms[currentRoom];
    const requester = usersInRoom.find((u) => u.id === socket.id);
    if (!requester || !requester.isAdmin) {
      socket.emit("actionError", { type: "poll", message: "Anket başlatmak için yetkiniz yok." });
      return;
    }
    if (roomActivePoll[currentRoom]) {
      socket.emit("actionError", { type: "poll", message: "Zaten aktif bir anket var." });
      return;
    }
    const cleanedQuestion = (question || "").toString().trim();
    const cleanedOptions = Array.isArray(options)
      ? options.map((o) => (o || "").toString().trim()).filter((o) => o.length > 0)
      : [];
    if (!cleanedQuestion || cleanedOptions.length < 2) {
      socket.emit("actionError", { type: "poll", message: "Geçerli bir soru ve en az iki seçenek girin." });
      return;
    }
    const pollId = `poll-${Date.now()}`;
    const startedAt = Date.now();
    const endsAt = durationSec && Number.isFinite(durationSec) && durationSec > 0 ? startedAt + durationSec * 1000 : null;
    const poll = {
      id: pollId,
      question: cleanedQuestion,
      options: cleanedOptions.map((text) => ({ text, count: 0 })),
      multiple: !!multiple,
      startedAt,
      endsAt,
      votedUserIds: [],
      // sunucu içi saklama
      _votesByUser: {}, // userId -> number[]
    };
    roomActivePoll[currentRoom] = poll;
    // Zamanlayıcı kur
    if (endsAt) {
      if (roomPollTimers[currentRoom]) {
        clearTimeout(roomPollTimers[currentRoom]);
      }
      roomPollTimers[currentRoom] = setTimeout(() => {
        // Süre doldu, anketi bitir
        const p = roomActivePoll[currentRoom];
        if (!p) return;
        io.to(currentRoom).emit("pollEnded", sanitizePoll(p));
        roomActivePoll[currentRoom] = null;
        delete roomPollTimers[currentRoom];
      }, Math.max(0, endsAt - Date.now()));
    }
    io.to(currentRoom).emit("pollStarted", sanitizePoll(poll));
    // Ayrıca aktif anketi göndermek için
    io.to(currentRoom).emit("activePoll", sanitizePoll(poll));
  });

  // Anket oyu verme
  socket.on("votePoll", ({ room, optionIndexes }) => {
    const currentRoom = room?.toLowerCase?.() || socket.room;
    if (!currentRoom || !rooms[currentRoom]) return;
    const poll = roomActivePoll[currentRoom];
    if (!poll) {
      socket.emit("actionError", { type: "poll", message: "Aktif anket bulunmuyor." });
      return;
    }
    if (poll.votedUserIds.includes(socket.id)) {
      socket.emit("actionError", { type: "poll", message: "Bu ankete zaten oy verdiniz." });
      return;
    }
    // Seçimleri normalize et
    let selected = Array.isArray(optionIndexes) ? optionIndexes.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n)) : [];
    if (!poll.multiple) {
      selected = selected.length > 0 ? [selected[0]] : [];
    }
    selected = [...new Set(selected)].filter((idx) => idx >= 0 && idx < poll.options.length);
    if (selected.length === 0) {
      socket.emit("actionError", { type: "poll", message: "Geçerli bir seçenek seçin." });
      return;
    }
    // Oyları işle
    selected.forEach((idx) => {
      poll.options[idx].count += 1;
    });
    poll.votedUserIds.push(socket.id);
    poll._votesByUser[socket.id] = selected;
    io.to(currentRoom).emit("pollUpdated", sanitizePoll(poll));
  });

  // Anketi bitir (yalnızca admin)
  socket.on("endPoll", ({ room }) => {
    const currentRoom = room?.toLowerCase?.() || socket.room;
    if (!currentRoom || !rooms[currentRoom]) return;
    const usersInRoom = rooms[currentRoom];
    const requester = usersInRoom.find((u) => u.id === socket.id);
    if (!requester || !requester.isAdmin) {
      socket.emit("actionError", { type: "poll", message: "Anketi bitirmek için yetkiniz yok." });
      return;
    }
    const poll = roomActivePoll[currentRoom];
    if (!poll) return;
    if (roomPollTimers[currentRoom]) {
      clearTimeout(roomPollTimers[currentRoom]);
      delete roomPollTimers[currentRoom];
    }
    io.to(currentRoom).emit("pollEnded", sanitizePoll(poll));
    roomActivePoll[currentRoom] = null;
  });

  // Mesaj arama event'i
  socket.on("searchMessages", ({ room, query }, callback) => {
    if (!roomMessages[room]) {
      callback([]);
      return;
    }
    const lowerQuery = query.toLowerCase();
    const results = roomMessages[room].filter(
      (msg) =>
        (msg.text && msg.text.toLowerCase().includes(lowerQuery)) ||
        (msg.user && msg.user.username && msg.user.username.toLowerCase().includes(lowerQuery))
    );
    callback(results);
  });

  socket.on("disconnect", () => {
    const room = socket.room;
    if (socket.username && room && rooms[room]) {
      rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
      // Admin ayrıldıysa kalan ilk kullanıcıyı admin yap
      if (rooms[room].length > 0 && !rooms[room].some((u) => u.isAdmin)) {
        rooms[room][0].isAdmin = true;
        io.to(room).emit("message", { type: "system", text: `${rooms[room][0].username} yeni admin oldu.` });
      }
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
        delete roomAppearance[room];
        delete roomActivePoll[room];
        if (roomPollTimers[room]) {
          clearTimeout(roomPollTimers[room]);
          delete roomPollTimers[room];
        }
      }
    }
  });
});

// İstemcilere gönderilecek anket objesini temizle
function sanitizePoll(poll) {
  if (!poll) return null;
  const { _votesByUser, ...pub } = poll;
  return pub;
}

server.listen(port, () =>
  console.log(`✅ Sunucu ${port} portunda çalışıyor...`)
);