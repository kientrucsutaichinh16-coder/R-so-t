import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="pwa-no-print fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-amber-400/60 bg-amber-950/95 px-3.5 py-1.5 text-xs font-medium text-amber-100 shadow-lg backdrop-blur-md">
      <WifiOff className="h-3.5 w-3.5 text-amber-300" />
      <span>Chế độ ngoại tuyến — Đang sử dụng dữ liệu đã lưu</span>
    </div>
  );
};
