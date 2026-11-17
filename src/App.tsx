/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SheetsSyncModal, type AutoSaveConfig } from './components/SheetsSyncModal';
import { getAccessToken, initAuth } from './services/googleAuth';
import {
  sendToAppsScriptWebhook,
  upsertSubmissionToSpreadsheet,
} from './services/googleSheetsService';
import {
  extractKhaiMinhData,
  generateSessionId,
  type ExtractedKhaiMinhData,
} from './utils/extractKhaiMinhData';

const SOURCE_HTML_PATH = '/assets/aistudio/KhaiMinh_HanhTrinh_TaiChinh_c0841716.html';
const APPS_SCRIPT_URL_STORAGE_KEY = 'km_apps_script_url';
const AUTO_SAVE_DEBOUNCE_MS = 1200;

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sessionIdRef = useRef<string>(generateSessionId());
  const sheetRowNumberRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastSavedPayloadRef = useRef<string>('');
  const isSyncingRef = useRef<boolean>(false);
  const pendingResyncRef = useRef<boolean>(false);

  const [autoSaveConfig, setAutoSaveConfig] = useState<AutoSaveConfig | null>(() => {
    const savedAppsScript = localStorage.getItem(APPS_SCRIPT_URL_STORAGE_KEY)?.trim();
    if (savedAppsScript) {
      return { mode: 'apps_script', appsScriptUrl: savedAppsScript };
    }
    return null;
  });
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);

  const getExtractedData = useCallback((): ExtractedKhaiMinhData => {
    const doc = iframeRef.current?.contentDocument || null;
    return extractKhaiMinhData(doc, sessionIdRef.current);
  }, []);

  const syncNow = useCallback(
    async (configOverride?: AutoSaveConfig | null) => {
      const cfg = configOverride ?? autoSaveConfig;
      if (!cfg) return;

      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;

      const data = extractKhaiMinhData(doc, sessionIdRef.current);
      if (data.filledCount === 0) return;

      // Avoid duplicate network writes if values (excluding timestamp) did not change
      const comparablePayload = JSON.stringify([data.values[0], ...data.values.slice(2)]);
      if (comparablePayload === lastSavedPayloadRef.current) return;

      if (isSyncingRef.current) {
        pendingResyncRef.current = true;
        return;
      }

      isSyncingRef.current = true;
      try {
        if (cfg.mode === 'apps_script' && cfg.appsScriptUrl) {
          await sendToAppsScriptWebhook(cfg.appsScriptUrl, data.headers, data.values);
          lastSavedPayloadRef.current = comparablePayload;
        } else if (cfg.mode === 'google' && cfg.spreadsheetId) {
          const token = await getAccessToken();
          if (!token) {
            // Token expired or not yet obtained after reload; require explicit sign-in
            setAutoSaveConfig(null);
            return;
          }
          const res = await upsertSubmissionToSpreadsheet(
            token,
            cfg.spreadsheetId,
            data.headers,
            data.values,
            sheetRowNumberRef.current
          );
          if (res.rowNumber) {
            sheetRowNumberRef.current = res.rowNumber;
          }
          lastSavedPayloadRef.current = comparablePayload;
        }
      } catch (err) {
        console.error('Auto-save to Google Sheet failed:', err);
      } finally {
        isSyncingRef.current = false;
        if (pendingResyncRef.current) {
          pendingResyncRef.current = false;
          window.setTimeout(() => {
            void syncNow(cfg);
          }, 300);
        }
      }
    },
    [autoSaveConfig]
  );

  const scheduleAutoSave = useCallback(() => {
    if (!autoSaveConfig) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void syncNow();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, [autoSaveConfig, syncNow]);

  useEffect(() => {
    const unsubscribe = initAuth(undefined, () => {
      setAutoSaveConfig((prev) => (prev?.mode === 'google' ? null : prev));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setIsSetupModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cleanupListeners: (() => void) | undefined;

    const attachIframeListeners = () => {
      cleanupListeners?.();
      const doc = iframe.contentDocument;
      if (!doc) return;

      const handleUpdate = (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button[onclick*="resetAll"]')) {
          // Start a fresh session row if user intentionally resets all data
          window.setTimeout(() => {
            const after = extractKhaiMinhData(doc, sessionIdRef.current);
            if (after.filledCount === 0) {
              sessionIdRef.current = generateSessionId();
              sheetRowNumberRef.current = null;
              lastSavedPayloadRef.current = '';
            }
          }, 50);
          return;
        }
        window.setTimeout(scheduleAutoSave, 0);
      };

      const handleDocKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
          e.preventDefault();
          setIsSetupModalOpen(true);
        }
      };

      doc.addEventListener('input', handleUpdate);
      doc.addEventListener('change', handleUpdate);
      doc.addEventListener('click', handleUpdate);
      doc.addEventListener('keydown', handleDocKeyDown);

      cleanupListeners = () => {
        doc.removeEventListener('input', handleUpdate);
        doc.removeEventListener('change', handleUpdate);
        doc.removeEventListener('click', handleUpdate);
        doc.removeEventListener('keydown', handleDocKeyDown);
      };
    };

    iframe.addEventListener('load', attachIframeListeners);
    if (iframe.contentDocument?.readyState === 'complete') {
      attachIframeListeners();
    }

    return () => {
      iframe.removeEventListener('load', attachIframeListeners);
      cleanupListeners?.();
    };
  }, [scheduleAutoSave]);

  useEffect(() => {
    const handleVisibilityOrHide = () => {
      if (document.visibilityState === 'hidden') {
        void syncNow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrHide);
    window.addEventListener('pagehide', handleVisibilityOrHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrHide);
      window.removeEventListener('pagehide', handleVisibilityOrHide);
    };
  }, [syncNow]);

  const handleActivateAutoSave = async (config: AutoSaveConfig) => {
    setAutoSaveConfig(config);
    sheetRowNumberRef.current = null;
    lastSavedPayloadRef.current = '';
    await syncNow(config);
  };

  const handleDisableAutoSave = () => {
    localStorage.removeItem(APPS_SCRIPT_URL_STORAGE_KEY);
    setAutoSaveConfig(null);
    sheetRowNumberRef.current = null;
    lastSavedPayloadRef.current = '';
  };

  return (
    <main className="pwa-safe-shell relative h-dvh w-full overflow-hidden bg-[#04130e]">
      <iframe
        ref={iframeRef}
        src={SOURCE_HTML_PATH}
        title="Khai Minh – Hành Trình Tài Chính An Yên & Thịnh Vượng"
        className="block h-full w-full border-0"
      />

      {/* Only show Sign in with Google when not connected yet; never display a "Lưu về Google Sheet" button */}
      <div className="pwa-no-print fixed right-3 bottom-3 z-40 flex flex-col items-end gap-2">
        {!autoSaveConfig && (
          <button
            type="button"
            onClick={() => setIsSetupModalOpen(true)}
            className="gsi-material-button shadow-xl"
          >
            <div className="gsi-material-button-state" />
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
              </div>
              <span className="gsi-material-button-contents">Sign in with Google</span>
            </div>
          </button>
        )}
        <PWAInstallButton />
      </div>

      <SheetsSyncModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        extractData={getExtractedData}
        activeConfig={autoSaveConfig}
        onActivateAutoSave={handleActivateAutoSave}
        onDisableAutoSave={handleDisableAutoSave}
      />

      <OfflineIndicator />
    </main>
  );
}
