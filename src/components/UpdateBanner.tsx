import { useRegisterSW } from 'virtual:pwa-register/preact';

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // A home-screen app is often resumed rather than reloaded, so check for updates on every return to it
      if (reg) document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update());
    },
  });

  if (!needRefresh) return null;
  return (
    <div class="card banner">
      <p>גרסה חדשה מוכנה. הנתונים שלך לא יימחקו, ולפני המעבר יישמר עותק בטיחות.</p>
      <button onClick={() => updateServiceWorker(true)}>עדכן עכשיו</button>
    </div>
  );
}
