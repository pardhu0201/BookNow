'use strict';

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { UUID } = require('./validate');

// Bridges domain events on the bus to Socket.IO rooms: one room per event for
// seat changes and one per visitor session for private notifications.
function attachRealtime({ server, bus, auth, redis, config }) {
  const io = new Server(server, {
    cors: config.env === 'development' ? { origin: true } : undefined,
  });
  // Redis adapter: broadcasts reach clients connected to any instance.
  if (redis) io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));

  io.use((socket, next) => {
    socket.data.sessionId = auth.verify(socket.handshake.auth?.token);
    next();
  });

  async function broadcastPresence(eventId) {
    const sockets = await io.in(`event:${eventId}`).fetchSockets();
    io.to(`event:${eventId}`).emit('presence', { eventId, viewers: sockets.length });
  }

  io.on('connection', (socket) => {
    if (socket.data.sessionId) socket.join(`session:${socket.data.sessionId}`);

    socket.on('event:join', async (eventId) => {
      if (typeof eventId !== 'string' || !UUID.test(eventId)) return;
      const previous = socket.data.eventId;
      if (previous) socket.leave(`event:${previous}`);
      socket.data.eventId = eventId;
      socket.join(`event:${eventId}`);
      await broadcastPresence(eventId).catch(() => {});
      if (previous && previous !== eventId) await broadcastPresence(previous).catch(() => {});
    });

    socket.on('disconnect', () => {
      if (socket.data.eventId) broadcastPresence(socket.data.eventId).catch(() => {});
    });
  });

  bus.on('seat', (e) => io.to(`event:${e.eventId}`).emit('seat', e));
  bus.on('reset', (e) => io.to(`event:${e.eventId}`).emit('reset', e));
  bus.on('activity', (e) => io.to(`event:${e.eventId}`).emit('activity', { ...e, at: new Date().toISOString() }));
  bus.on('notify', ({ sessionId, ...payload }) => io.to(`session:${sessionId}`).emit('notify', payload));

  return io;
}

module.exports = { attachRealtime };
