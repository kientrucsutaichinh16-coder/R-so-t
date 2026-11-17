import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || dismissed) {
    return null;
  }

  if (isInstallable) {
    return (
      <div className="flex items-center gap-1 rounded-full border border-[#d9b45a]/75 bg-[#06261a]/95 p-1 pl-3.5 text-[#f6e3b0] shadow-xl backdrop-blur-md">
        <button
          type="button"
          onClick={install}
          className="flex cursor-pointer items-center gap-2 text-xs font-semibold tracking-wide transition-colors hover:text-white sm:text-sm"
        >
          <Download className="h-4 w-4 text-[#d9b45a]" />
          <span>Cài đặt App</span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Ẩn nút cài đặt"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#d9b45a]/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (isIOS) {
    return (
      <>
        <div className="flex items-center gap-1 rounded-full border border-[#d9b45a]/75 bg-[#06261a]/95 p-1 pl-3.5 text-[#f6e3b0] shadow-xl backdrop-blur-md">
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="flex cursor-pointer items-center gap-2 text-xs font-semibold tracking-wide transition-colors hover:text-white sm:text-sm"
          >
            <Smartphone className="h-4 w-4 text-[#d9b45a]" />
            <span>Cài đặt iOS</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Ẩn nút cài đặt"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#d9b45a]/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {showIOSGuide && (
          <div className="pwa-no-print fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl border border-[#d9b45a]/70 bg-[#06261a] p-6 text-[#f6e3b0] shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-bold text-[#fff1c1]">
                  Cài đặt trên iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Đóng hướng dẫn"
                  className="rounded-full p-1 text-[#d9b45a] hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-[#e7efe9]">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#d9b45a]">1.</span>
                  <span>
                    Nhấn nút <strong className="text-[#fff1c1]">Chia sẻ</strong>{' '}
                    <Share className="inline h-3.5 w-3.5 text-[#d9b45a]" /> trên thanh công cụ Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#d9b45a]">2.</span>
                  <span>
                    Cuộn xuống và chọn{' '}
                    <strong className="text-[#fff1c1]">Thêm vào Màn hình chính</strong> (Add to Home Screen).
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full cursor-pointer rounded-xl border border-[#d9b45a] bg-[#0b3c2a] py-2.5 text-sm font-semibold text-[#fff1c1] transition-colors hover:bg-[#13513c]"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
