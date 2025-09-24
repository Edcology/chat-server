import express from "express";
import http from "http";
import { Server } from "socket.io";
import { jwtVerify } from "jose";
import { prisma } from './lib/prisma';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET
);

// Authenticate each socket
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("No token provided"));

    const { payload } = await jwtVerify(token, JWT_SECRET);

    socket.data.user = {
      id: payload.id as string,
      email: payload.email as string,
    };

    next();
  } catch (err) {
    console.error("Socket auth error:", err);
    next(new Error("Unauthorized"));
  }
});

// Socket events
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.data.user);

  socket.on("join", async (chatId: string) => {
    socket.join(chatId);
    console.log(`User ${socket.data.user.id} joined room ${chatId}`);

    // Fetch recent messages
    const messages = await prisma.message.findMany({
      where: { 
        chatId,
        isDeleted: false // Only fetch non-deleted messages
      },
      orderBy: { createdAt: "asc" },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      },
    });

    // Send them only to this user
    socket.emit("chatHistory", messages);
  });

  socket.on("message", async ({ chatId, content, type = "TEXT" }) => {
    try {
      // Validate message type
      const messageType = type.toString().toUpperCase();
      if (!["TEXT", "IMAGE", "FILE", "AUDIO", "VIDEO"].includes(messageType)) {
        throw new Error("Invalid message type");
      }

      // Save message to DB
      const newMessage = await prisma.message.create({
        data: {
          content,
          type: messageType, // Use the validated type
          chatId,
          senderId: socket.data.user.id,
          isEdited: false,
          isDeleted: false,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        },
      });

      // Broadcast to room
      io.to(chatId).emit("message", newMessage);
    } catch (err) {
      console.error("Message save error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.data.user);
  });
});

// Express test
app.get("/", (req, res) => {
  res.send("<h1>Socket.IO server with Prisma</h1>");
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
