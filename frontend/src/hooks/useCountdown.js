import { useState, useEffect } from 'react';

function calcRemaining(endsAt) {
  if (!endsAt) return null;
  const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const totalSec = Math.floor(diff / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}

/** Conta regressiva legível: "14m 30s" */
export function useCountdown(endsAt) {
  const [remaining, setRemaining] = useState(calcRemaining(endsAt));

  useEffect(() => {
    const id = setInterval(() => setRemaining(calcRemaining(endsAt)), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return remaining;
}
