/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Timer, Play, RotateCcw, MousePointer2 } from 'lucide-react';
import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';

// Game Constants
const GAME_DURATION = 30; // seconds
const GRID_SIZE = 9;
const SPAWN_INTERVAL = 1000; // ms between spawn attempts
const MOLE_STAY_DURATION = 500; // ms mole stays up
const MAX_ACTIVE_MOLES = 3; // maximum moles on screen

enum GameState {
  IDLE,
  PLAYING,
  FINISHED
}

interface MoleInstance {
  id: number;
  status: 'up' | 'down' | 'hit';
}

interface LeaderboardEntry {
  playerName: string;
  score: number;
  createdAt?: any;
}

// Error handling as per skill
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We can show a toast or message in UI if we had one
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.IDLE);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('whack_mole_player_name') || '');
  const [moles, setMoles] = useState<MoleInstance[]>(
    Array.from({ length: GRID_SIZE }, (_, i) => ({ id: i, status: 'down' }))
  );
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('whack_mole_high_score');
    return saved ? parseInt(saved, 10) : 0;
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const spawnRef = useRef<NodeJS.Timeout | null>(null);

  // Leaderboard data
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);

  // Sound placeholders (visual only for now)
  const [bonusText, setBonusText] = useState<{ id: number; x: number; y: number; text: string }[]>([]);

  // Start Game
  const startGame = () => {
    if (!playerName.trim()) {
      alert('请输入你的大名！');
      return;
    }
    localStorage.setItem('whack_mole_player_name', playerName);
    setGameState(GameState.PLAYING);
    setScore(0);
    setTimeLeft(GAME_DURATION);
    setMoles(Array.from({ length: GRID_SIZE }, (_, i) => ({ id: i, status: 'down' })));
  };

  // End Game
  const endGame = useCallback(async () => {
    setGameState(GameState.FINISHED);
    if (timerRef.current) clearInterval(timerRef.current);
    if (spawnRef.current) clearTimeout(spawnRef.current);
    
    setMoles(prev => prev.map(m => ({ ...m, status: 'down' })));

    // Submit score to leaderboard
    if (score > 0) {
      try {
        await addDoc(collection(db, 'leaderboard'), {
          playerName: playerName || '匿名高手',
          score: score,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'leaderboard');
      }
    }
  }, [score, playerName]);

  // Timer Effect
  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            endGame();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, endGame]);

  // High Score Effect
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('whack_mole_high_score', score.toString());
    }
  }, [score, highScore]);

  // Real-time Leaderboard
  useEffect(() => {
    setLoadingLeaderboard(true);
    const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: LeaderboardEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push(doc.data() as LeaderboardEntry);
      });
      setLeaderboard(entries);
      setLoadingLeaderboard(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leaderboard');
      setLoadingLeaderboard(false);
    });

    return () => unsubscribe();
  }, []);

  // Mole Spawning Logic
  const spawnMole = useCallback(() => {
    if (gameState !== GameState.PLAYING) return;

    // Check concurrency limit
    const activeMoles = moles.filter(m => m.status === 'up').length;
    if (activeMoles >= MAX_ACTIVE_MOLES) {
      spawnRef.current = setTimeout(spawnMole, 300); // Check again soon
      return;
    }

    // Pick a random hole that is down
    const availableHoles = moles.filter(m => m.status === 'down');
    if (availableHoles.length === 0) {
      spawnRef.current = setTimeout(spawnMole, SPAWN_INTERVAL);
      return;
    }

    const randomIndex = Math.floor(Math.random() * availableHoles.length);
    const holeId = availableHoles[randomIndex].id;

    // Show mole
    setMoles(prev => prev.map(m => m.id === holeId ? { ...m, status: 'up' } : m));

    // Hide mole after fixed duration
    const hideTimeout = setTimeout(() => {
      setMoles(prev => prev.map(m => (m.id === holeId && m.status === 'up') ? { ...m, status: 'down' } : m));
    }, MOLE_STAY_DURATION);

    // Schedule next spawn
    spawnRef.current = setTimeout(spawnMole, SPAWN_INTERVAL);

    return () => clearTimeout(hideTimeout);
  }, [gameState, moles]);

  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      spawnMole();
    }
    return () => {
      if (spawnRef.current) clearTimeout(spawnRef.current);
    };
  }, [gameState, spawnMole]);

  // Whack Handler
  const handleWhack = (id: number, e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    const mole = moles.find(m => m.id === id);
    if (mole && mole.status === 'up') {
      setScore(prev => prev + 10);
      setMoles(prev => prev.map(m => m.id === id ? { ...m, status: 'hit' } : m));
      
      // Bonus text effect
      const x = 'clientX' in e ? e.clientX : (e as React.TouchEvent).touches[0].clientX;
      const y = 'clientY' in e ? e.clientY : (e as React.TouchEvent).touches[0].clientY;
      
      const bonusId = Date.now();
      setBonusText(prev => [...prev.slice(-5), { id: bonusId, x, y, text: '+10' }]);
      setTimeout(() => {
        setBonusText(prev => prev.filter(b => b.id !== bonusId));
      }, 1000);

      // Hide after hit
      setTimeout(() => {
        setMoles(prev => prev.map(m => m.id === id ? { ...m, status: 'down' } : m));
      }, 300);
    }
  };

  return (
    <div className="min-h-screen bg-[#8BC34A] flex flex-col items-center justify-center font-sans overflow-hidden select-none touch-none">
      {/* Background Texture */}
      <div 
        className="fixed inset-0 opacity-40 pointer-events-none"
        style={{ 
          backgroundImage: `url('/src/assets/images/grass_field_1779088363142.png')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      />

      {/* Header UI */}
      <div className="relative z-10 w-full max-w-md px-6 mb-8 flex items-center justify-between">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-4 py-2 flex items-center gap-3 shadow-lg border-2 border-green-700/20">
          <Trophy className="text-yellow-500 w-6 h-6" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">分数</span>
            <span className="text-xl font-black text-green-800">{score}</span>
          </div>
        </div>

        <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-4 py-2 flex items-center gap-3 shadow-lg border-2 border-green-700/20">
          <Timer className={`${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-blue-500'} w-6 h-6`} />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">剩余时间</span>
            <span className={`text-xl font-black ${timeLeft <= 5 ? 'text-red-600' : 'text-blue-800'}`}>{timeLeft}s</span>
          </div>
        </div>
      </div>

      {/* Game Board */}
      <div className="relative z-10 grid grid-cols-3 gap-4 p-4 bg-green-800/20 rounded-3xl backdrop-blur-sm shadow-2xl border-4 border-white/30">
        {moles.map((mole) => (
          <div 
            key={mole.id} 
            id={`hole-${mole.id}`}
            className="relative w-24 h-24 md:w-32 md:h-32 bg-amber-900/60 rounded-full overflow-hidden shadow-inner flex items-end justify-center cursor-pointer"
            onPointerDown={(e) => handleWhack(mole.id, e)}
          >
            {/* Hole Shadow */}
            <div className="absolute inset-x-2 bottom-0 h-4 bg-black/40 rounded-full blur-sm" />
            
            {/* Mole Component (Emoji replacement) */}
            <AnimatePresence>
              {(mole.status === 'up' || mole.status === 'hit') && (
                <motion.div
                  initial={{ y: 120 }}
                  animate={{ y: 0 }}
                  exit={{ y: 120 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 300 }}
                  className="relative z-20 w-fit h-fit pointer-events-none text-6xl md:text-8xl flex items-center justify-center -mb-2"
                >
                  <span className={`transition-transform duration-100 ${mole.status === 'hit' ? 'scale-125 rotate-12' : ''}`}>
                    {mole.status === 'hit' ? '🐹😵' : '🐹'}
                  </span>
                  {mole.status === 'hit' && (
                    <motion.div 
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1.5, opacity: 1 }}
                      className="absolute -top-4 -right-4 text-3xl"
                    >
                      💥
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="mt-8 text-center text-white font-medium drop-shadow-md">
        个人最高分: <span className="font-black text-yellow-300">{highScore}</span>
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {gameState === GameState.IDLE && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-[40px] p-8 w-full max-w-sm text-center shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="space-y-2">
                <h1 className="text-4xl font-black text-green-600 tracking-tight">打地鼠大作战</h1>
                <p className="text-gray-500 font-bold italic">你能拿多少分？</p>
              </div>
              
              <div className="aspect-square w-24 mx-auto bg-green-50 rounded-full flex items-center justify-center text-6xl">
                🐹
              </div>

              <div className="space-y-4">
                <div className="space-y-2 text-left">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest px-2">你的大名</label>
                  <input 
                    type="text" 
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="输入名字..."
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 font-bold text-center focus:border-green-400 outline-none transition-colors"
                  />
                </div>

                <button 
                  onClick={startGame}
                  className="w-full bg-green-500 hover:bg-green-600 active:scale-95 transition-all text-white py-4 rounded-3xl font-black text-xl shadow-xl shadow-green-500/20 flex items-center justify-center gap-3"
                >
                  <Play className="fill-current" />
                  开始游戏
                </button>
              </div>

              {/* Leaderboard preview */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">🏆 全球排行榜 🏆</h3>
                <div className="space-y-2">
                  {loadingLeaderboard ? (
                    <div className="text-sm text-gray-300 py-2">加载中...</div>
                  ) : leaderboard.length > 0 ? leaderboard.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-gray-50/50 rounded-xl px-4 py-2 border border-gray-100/50">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 font-black text-xs ${idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-gray-400' : idx === 2 ? 'text-orange-400' : 'text-gray-300'}`}>
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-gray-700 text-sm truncate max-w-[120px]">{entry.playerName}</span>
                      </div>
                      <span className="font-black text-green-600">{entry.score}</span>
                    </div>
                  )) : (
                    <div className="text-sm text-gray-300 py-2">暂无排名，快来抢占第一！</div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gameState === GameState.FINISHED && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="bg-white rounded-[40px] p-8 w-full max-w-sm text-center shadow-2xl space-y-6 overflow-hidden relative max-h-[90vh] overflow-y-auto"
            >
              <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-yellow-400 via-orange-500 to-yellow-400" />
              
              <div className="space-y-2">
                <h2 className="text-3xl font-black text-gray-900 italic">游戏结束!</h2>
                <p className="text-gray-500 font-medium">{playerName} 的战绩</p>
              </div>

              <div className="bg-gray-50 rounded-3xl p-6 space-y-4 border-2 border-gray-100 relative">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-bold uppercase text-xs tracking-widest">最终得分</span>
                  <span className="text-4xl font-black text-green-600 italic">{score}</span>
                </div>
                <div className="h-px bg-gray-200" />
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400 font-bold uppercase text-xs tracking-widest">个人最好</span>
                  <span className="font-bold text-yellow-600">{highScore}</span>
                </div>
              </div>

              {/* Leaderboard list */}
              <div className="space-y-3">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">🏆 巅峰战况 🏆</h3>
                <div className="bg-gray-50 rounded-2xl p-2 space-y-1">
                  {leaderboard.map((entry, idx) => (
                    <div key={idx} className={`flex items-center justify-between rounded-xl px-4 py-3 transition-colors ${entry.playerName === playerName && entry.score === score ? 'bg-green-100 border-2 border-green-200' : 'bg-white shadow-sm'}`}>
                      <div className="flex items-center gap-3">
                        <span className="font-black text-xs text-gray-400">#{idx + 1}</span>
                        <span className="font-bold text-gray-700 text-sm">{entry.playerName}</span>
                      </div>
                      <span className="font-black text-green-600">{entry.score}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                onClick={startGame}
                className="w-full bg-orange-500 hover:bg-orange-600 active:scale-95 transition-all text-white py-4 rounded-3xl font-black text-xl shadow-xl shadow-orange-500/20 flex items-center justify-center gap-3"
              >
                <RotateCcw className="w-6 h-6" />
                再战辉煌
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Effects */}
      {bonusText.map(bonus => (
        <motion.div
          key={bonus.id}
          initial={{ y: bonus.y - 40, x: bonus.x - 20, opacity: 1, scale: 0.5 }}
          animate={{ y: bonus.y - 100, opacity: 0, scale: 1.5 }}
          className="fixed z-[100] text-3xl font-black text-yellow-300 pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
        >
          {bonus.text}
        </motion.div>
      ))}

      {/* Custom Styles for touch prevention */}
      <style>{`
        body {
          touch-action: none;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
    </div>
  );
}
