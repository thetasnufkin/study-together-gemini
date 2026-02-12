import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // ★変更: どこからでもアクセスできるように "*" に変更
    origin: "*",
    methods: ["GET", "POST"]
  }
});

interface User {
  socketId: string;
  username: string;
  task: string;
  peerId?: string;
}

interface Room {
  roomId: string;
  timer: number;
  phase: 'WORK' | 'BREAK';
  isRunning: boolean;
  hostId: string;
  users: User[];
}

const rooms: Record<string, Room> = {};
const WORK_TIME = 25 * 60; 
const BREAK_TIME = 5 * 60;

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username, peerId }: { roomId: string, username: string, peerId: string }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { roomId, timer: WORK_TIME, phase: 'WORK', isRunning: false, hostId: socket.id, users: [] };
    }
    const room = rooms[roomId];
    const existingUserIndex = room.users.findIndex(u => u.socketId === socket.id);
    if (existingUserIndex === -1) {
      room.users.push({ socketId: socket.id, username, task: '', peerId });
    }
    io.to(roomId).emit('update_room', room);
  });

  socket.on('update_task', ({ roomId, task }: { roomId: string, task: string }) => {
    const room = rooms[roomId];
    if (!room) return;
    const user = room.users.find(u => u.socketId === socket.id);
    if (user) {
      user.task = task;
      io.to(roomId).emit('update_room', room);
    }
  });

  socket.on('toggle_timer', (roomId: string) => {
    const room = rooms[roomId];
    if (room && room.hostId === socket.id) {
      room.isRunning = !room.isRunning;
      io.to(roomId).emit('update_room', room);
    }
  });

  socket.on('skip_phase', (roomId: string) => {
    const room = rooms[roomId];
    if (room && room.hostId === socket.id) {
       switchPhase(room);
       io.to(roomId).emit('update_room', room);
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const userIndex = room.users.findIndex(u => u.socketId === socket.id);
      if (userIndex !== -1) {
        room.users.splice(userIndex, 1);
        if (room.hostId === socket.id && room.users.length > 0) room.hostId = room.users[0].socketId;
        if (room.users.length === 0) delete rooms[roomId];
        else io.to(roomId).emit('update_room', room);
      }
    }
  });
});

setInterval(() => {
  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.isRunning && room.timer > 0) {
      room.timer -= 1;
      if (room.timer === 0) {
        switchPhase(room);
        io.to(roomId).emit('update_room', room);
      }
    }
  });
  Object.keys(rooms).forEach((roomId) => {
      const room = rooms[roomId];
      if (room) io.to(roomId).emit('timer_sync', room.timer);
  });
}, 1000);

async function switchPhase(room: Room) {
  if (room.phase === 'WORK') {
    const logs = room.users.map(user => ({
      room_id: room.roomId, username: user.username, duration_seconds: WORK_TIME
    }));
    if (logs.length > 0) await supabase.from('study_logs').insert(logs);
    
    room.phase = 'BREAK';
    room.timer = BREAK_TIME;
  } else {
    room.phase = 'WORK';
    room.timer = WORK_TIME;
  }
  room.isRunning = false;
}

// ★変更: クラウド環境のポート(process.env.PORT)を優先して使う
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { console.log(`SERVER RUNNING ON PORT ${PORT}`); });