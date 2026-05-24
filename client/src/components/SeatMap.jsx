import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const socket = io('http://localhost:4000');

export default function SeatMap({ eventId, userId, userEmail }) {
  const [seats, setSeats] = useState([]); // [{seatKey, status, expiresAt}]
  useEffect(() => {
    // fetch seat map
    axios.get(`/api/events/${eventId}/seatmap`).then(r => setSeats(r.data.seats));
    socket.on('seat_locked', data => {
      if (data.eventId !== eventId) return;
      setSeats(prev => prev.map(s => s.seatKey === data.seatKey ? { ...s, status: 'locked', lockOwner: data.userId, expiresIn: data.expiresIn } : s));
    });
    socket.on('seat_confirmed', data => {
      if (data.eventId !== eventId) return;
      setSeats(prev => prev.map(s => s.id === data.seatId ? { ...s, status: 'sold' } : s));
    });
    socket.on('seat_released', data => {
      if (data.eventId !== eventId) return;
      setSeats(prev => prev.map(s => s.seatKey === data.seatKey ? { ...s, status: 'available' } : s));
    });
    return () => socket.off();
  }, [eventId]);

  async function lockSeat(seatKey) {
    try {
      const res = await axios.post('/api/lock', { eventId, seatKey, userId, userEmail });
      const bookingId = res.data.bookingId;
      // redirect to create checkout
      const checkout = await axios.post('/api/create-checkout', { bookingId, successUrl: window.location.href, cancelUrl: window.location.href });
      window.location = checkout.data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Could not lock seat');
    }
  }

  return (
    <div className="grid grid-cols-10 gap-2">
      {seats.map(s => (
        <button key={s.seatKey} disabled={s.status !== 'available'} onClick={() => lockSeat(s.seatKey)}
          className={`p-3 border ${s.status==='available'?'bg-green-200': s.status==='locked'?'bg-yellow-200':'bg-gray-400'}`}>
          {s.seatKey}
          {s.status==='locked' && <div className="text-xs">Locked</div>}
        </button>
      ))}
    </div>
  );
}
