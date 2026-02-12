import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import io, { Socket } from 'socket.io-client';

// ★変更前: const SOCKET_URL = 'http://localhost:3001';
// ★変更後: 環境変数があればそれを使い、なければlocalhostを使うようにする
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// ...以下はそのまま

interface User {
  socketId: string;
  username: string;
  task: string;
  peerId?: string;
}

interface RoomState {
  roomId: string;
  timer: number;
  phase: 'WORK' | 'BREAK';
  isRunning: boolean;
  hostId: string;
  users: User[];
}

export default function RoomPage() {
  const router = useRouter();
  const { id: roomId } = router.query;
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<any>(null);
  const myStreamRef = useRef<MediaStream | null>(null);

  const [room, setRoom] = useState<RoomState | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [myTask, setMyTask] = useState('');
  const [username, setUsername] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [voiceConnected, setVoiceConnected] = useState(false);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      peerRef.current?.destroy();
      myStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleJoin = async () => {
    if (!username || !roomId) return;

    // 通話機能（PeerJS）の初期化
    const { Peer } = await import('peerjs');
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (peerId) => {
      socketRef.current = io(SOCKET_URL);
      socketRef.current.emit('join_room', { roomId, username, peerId });
      setHasJoined(true);

      socketRef.current.on('update_room', (data: RoomState) => {
        setRoom(data);
        setTimeLeft(data.timer);
        setIsHost(data.hostId === socketRef.current?.id);
      });

      socketRef.current.on('timer_sync', (time: number) => {
        setTimeLeft(time);
      });
    });

    // 着信時の処理
    peer.on('call', (call) => {
      if (myStreamRef.current) {
        call.answer(myStreamRef.current);
      } else {
        call.answer();
      }
      call.on('stream', (remoteStream) => {
        playAudio(call.peer, remoteStream);
      });
    });
  };

  const playAudio = (id: string, stream: MediaStream) => {
    let audio = document.getElementById(`audio-${id}`) as HTMLAudioElement;
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${id}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
  };

  // 休憩/作業フェーズの切り替わりでマイクを制御
  useEffect(() => {
    if (room?.phase === 'BREAK' && hasJoined) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        myStreamRef.current = stream;
        setVoiceConnected(true);
        // 部屋の全員に発信
        room.users.forEach((u) => {
          if (u.peerId && u.socketId !== socketRef.current?.id) {
            const call = peerRef.current?.call(u.peerId, stream);
            call?.on('stream', (remoteStream: MediaStream) => {
              playAudio(u.peerId!, remoteStream);
            });
          }
        });
      }).catch(err => console.error('Mic error:', err));
    } else {
      // WORKに戻ったらマイクをオフ
      if (myStreamRef.current) {
        myStreamRef.current.getTracks().forEach(track => track.stop());
        myStreamRef.current = null;
        setVoiceConnected(false);
      }
      document.querySelectorAll('audio').forEach(el => el.remove());
    }
  }, [room?.phase, hasJoined]);

  const handleTaskChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMyTask(e.target.value);
    socketRef.current?.emit('update_task', { roomId, task: e.target.value });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!hasJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
          <h1 className="text-2xl font-bold mb-6 text-center">Join Study Room</h1>
          <input type="text" placeholder="Nickname" className="w-full p-3 border rounded mb-4" value={username} onChange={(e) => setUsername(e.target.value)} />
          <button onClick={handleJoin} className="w-full bg-blue-600 text-white p-3 rounded font-bold hover:bg-blue-700" disabled={!username}>
            JOIN
          </button>
        </div>
      </div>
    );
  }

  if (!room) return <div className="p-10">Connecting...</div>;

  return (
    <div className={`min-h-screen p-8 transition-colors duration-500 ${room.phase === 'WORK' ? 'bg-red-50' : 'bg-green-50'}`}>
      <div className="max-w-4xl mx-auto flex justify-between items-center mb-8">
        <h1 className="text-xl font-bold text-gray-700">Room: {roomId}</h1>
        <div className="flex gap-4">
          {voiceConnected && <div className="text-sm bg-green-500 text-white px-3 py-1 rounded shadow animate-pulse">🎙️ マイクON</div>}
          <div className="text-sm bg-white px-3 py-1 rounded shadow">👤 {room.users.length} Users</div>
        </div>
      </div>

      <div className="text-center mb-12">
        <p className={`text-xl font-bold mb-2 ${room.phase === 'WORK' ? 'text-red-600' : 'text-green-600'}`}>
          {room.phase === 'WORK' ? '🔥 FOCUS TIME' : '☕ BREAK TIME'}
        </p>
        <div className="text-8xl font-mono font-bold text-gray-800">{formatTime(timeLeft)}</div>
        
        {isHost && (
          <div className="flex justify-center gap-4 mt-8">
            <button onClick={() => socketRef.current?.emit('toggle_timer', roomId)} className={`px-8 py-3 rounded-full font-bold text-white shadow-lg ${room.isRunning ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {room.isRunning ? 'PAUSE' : 'START'}
            </button>
            <button onClick={() => socketRef.current?.emit('skip_phase', roomId)} className="px-8 py-3 rounded-full font-bold bg-gray-500 text-white shadow-lg hover:bg-gray-600">
              SKIP
            </button>
          </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h2 className="text-lg font-bold mb-4 text-gray-700">✍️ Your Goal</h2>
          <input type="text" placeholder="What are you working on?" className="w-full p-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 outline-none" value={myTask} onChange={handleTaskChange} />
        </div>
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h2 className="text-lg font-bold mb-4 text-gray-700">👥 Members</h2>
          <ul className="space-y-3">
            {room.users.map((u) => (
              <li key={u.socketId} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div className="flex flex-col">
                  <span className="font-bold text-gray-800 flex items-center gap-2">
                    {u.username}
                    {u.socketId === room.hostId && <span className="text-xs bg-yellow-100 text-yellow-800 px-2 rounded-full">HOST</span>}
                    {u.socketId === socketRef.current?.id && <span className="text-xs bg-blue-100 text-blue-800 px-2 rounded-full">YOU</span>}
                  </span>
                  <span className="text-sm text-gray-500 truncate">{u.task || "No task set..."}</span>
                </div>
                <div className={`w-3 h-3 rounded-full ${room.phase === 'WORK' ? 'bg-red-500' : 'bg-green-500'}`}></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}