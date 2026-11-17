import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FolderPlus,
  Loader2,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  formatGoogleAuthError,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from '../services/googleAuth';
import {
  APPS_SCRIPT_SNIPPET,
  createKhaiMinhSpreadsheet,
  DEFAULT_APPS_SCRIPT_URL,
  getSpreadsheetMetadata,
  listAppSpreadsheets,
  parseSpreadsheetId,
  type DriveSpreadsheetItem,
  type SpreadsheetMetadata,
} from '../services/googleSheetsService';
import type { ExtractedKhaiMinhData } from '../utils/extractKhaiMinhData';

export interface AutoSaveConfig {
  mode: 'google' | 'apps_script';
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
  appsScriptUrl?: string;
}

interface SheetsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  extractData: () => ExtractedKhaiMinhData;
  activeConfig: AutoSaveConfig | null;
  onActivateAutoSave: (config: AutoSaveConfig) => Promise<void>;
  onDisableAutoSave: () => void;
}

const SPREADSHEET_ID_STORAGE_KEY = 'km_google_sheet_id';
const APPS_SCRIPT_URL_STORAGE_KEY = 'km_apps_script_url';

type SetupTab = 'google' | 'apps_script';

export const SheetsSyncModal: React.FC<SheetsSyncModalProps> = ({
  isOpen,
  onClose,
  extractData,
  activeConfig,
  onActivateAutoSave,
  onDisableAutoSave,
}) => {
  const [activeTab, setActiveTab] = useState<SetupTab>('apps_script');
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [spreadsheets, setSpreadsheets] = useState<DriveSpreadsheetItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string>(
    () => localStorage.getItem(SPREADSHEET_ID_STORAGE_KEY) || ''
  );
  const [customSheetInput, setCustomSheetInput] = useState('');
  const [activeSheetMeta, setActiveSheetMeta] = useState<SpreadsheetMetadata | null>(null);

  const [appsScriptUrl, setAppsScriptUrl] = useState<string>(
    () => localStorage.getItem(APPS_SCRIPT_URL_STORAGE_KEY) || DEFAULT_APPS_SCRIPT_URL
  );
  const [copiedScript, setCopiedScript] = useState(false);

  const [confirmMode, setConfirmMode] = useState<
    'google_existing' | 'google_create_new' | 'apps_script' | null
  >(null);

  const [isActivating, setIsActivating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setConfirmMode(null);
    }
  }, [isOpen]);

  const loadDriveFiles = async (token: string) => {
    setIsLoadingFiles(true);
    setErrorMsg(null);
    try {
      const files = await listAppSpreadsheets(token);
      setSpreadsheets(files);
      const savedId = localStorage.getItem(SPREADSHEET_ID_STORAGE_KEY);
      const candidateId = savedId || files[0]?.id;
      if (candidateId) {
        try {
          const meta = await getSpreadsheetMetadata(token, candidateId);
          setActiveSheetMeta(meta);
          setSelectedSheetId(meta.spreadsheetId);
          localStorage.setItem(SPREADSHEET_ID_STORAGE_KEY, meta.spreadsheetId);
        } catch {
          if (files[0] && files[0].id !== candidateId) {
            const meta = await getSpreadsheetMetadata(token, files[0].id);
            setActiveSheetMeta(meta);
            setSelectedSheetId(meta.spreadsheetId);
            localStorage.setItem(SPREADSHEET_ID_STORAGE_KEY, meta.spreadsheetId);
          }
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không tải được danh sách Google Sheet từ Drive.'
      );
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setErrorMsg(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setNeedsAuth(false);
      await loadDriveFiles(result.accessToken);
    } catch (err) {
      setErrorMsg(formatGoogleAuthError(err));
      setNeedsAuth(true);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    onDisableAutoSave();
    setUser(null);
    setNeedsAuth(true);
    setSpreadsheets([]);
    setActiveSheetMeta(null);
    setConfirmMode(null);
  };

  const handleSelectSheet = async (idOrUrl: string) => {
    const id = parseSpreadsheetId(idOrUrl);
    if (!id) return;
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    setIsLoadingFiles(true);
    setErrorMsg(null);
    try {
      const meta = await getSpreadsheetMetadata(token, id);
      setSelectedSheetId(meta.spreadsheetId);
      setActiveSheetMeta(meta);
      localStorage.setItem(SPREADSHEET_ID_STORAGE_KEY, meta.spreadsheetId);
      setCustomSheetInput('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không mở được Google Sheet này.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleConfirmActivate = async () => {
    if (!confirmMode) return;
    setIsActivating(true);
    setErrorMsg(null);
    try {
      if (confirmMode === 'apps_script') {
        const cleanUrl = appsScriptUrl.trim();
        if (!cleanUrl.startsWith('https://script.google.com/')) {
          throw new Error('Đường dẫn Apps Script phải bắt đầu bằng https://script.google.com/...');
        }
        localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, cleanUrl);
        await onActivateAutoSave({
          mode: 'apps_script',
          appsScriptUrl: cleanUrl,
        });
        setConfirmMode(null);
        onClose();
        return;
      }

      const token = await getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        setConfirmMode(null);
        setErrorMsg('Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại.');
        return;
      }

      let meta = activeSheetMeta;
      if (confirmMode === 'google_create_new' || !selectedSheetId) {
        const data = extractData();
        meta = await createKhaiMinhSpreadsheet(token, data.headers);
        setSelectedSheetId(meta.spreadsheetId);
        setActiveSheetMeta(meta);
        localStorage.setItem(SPREADSHEET_ID_STORAGE_KEY, meta.spreadsheetId);
      } else if (!meta) {
        meta = await getSpreadsheetMetadata(token, selectedSheetId);
        setActiveSheetMeta(meta);
      }

      await onActivateAutoSave({
        mode: 'google',
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
        spreadsheetUrl: meta.spreadsheetUrl,
      });
      setConfirmMode(null);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể bật tự động lưu vào Google Sheet. Bạn có thể thử tab Google Apps Script.'
      );
      setConfirmMode(null);
    } finally {
      setIsActivating(false);
    }
  };

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="pwa-no-print fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-xs sm:p-5">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#d9b45a]/75 bg-[#06261a] text-[#f6e3b0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d9b45a]/40 bg-[#04130e] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d9b45a]/60 bg-[#0b3c2a]">
              <FileSpreadsheet className="h-5 w-5 text-[#d9b45a]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#fff1c1] sm:text-lg">
                Thiết lập tự động lưu về Google Sheet
              </h2>
              <p className="text-xs text-[#b8cec2]">
                Sau khi kết nối 1 lần, mọi thông tin bạn nhập sẽ tự động lưu về Drive
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="cursor-pointer rounded-full p-1.5 text-[#d9b45a] hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex gap-2 border-b border-[#d9b45a]/25 bg-[#051d14] px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab('google');
              setConfirmMode(null);
            }}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition sm:text-sm ${
              activeTab === 'google'
                ? 'bg-[#d9b45a] text-[#04130e]'
                : 'border border-[#d9b45a]/35 text-[#f6e3b0] hover:bg-white/5'
            }`}
          >
            Google Drive &amp; Sheets
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('apps_script');
              setConfirmMode(null);
            }}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition sm:text-sm ${
              activeTab === 'apps_script'
                ? 'bg-[#d9b45a] text-[#04130e]'
                : 'border border-[#d9b45a]/35 text-[#f6e3b0] hover:bg-white/5'
            }`}
          >
            Google Apps Script (Sheet riêng)
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-400/50 bg-red-950/60 p-3.5 text-xs text-red-100 sm:text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeConfig && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/50 bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-100">
              <span>
                Đang tự động lưu về:{' '}
                <strong>
                  {activeConfig.mode === 'google'
                    ? activeConfig.spreadsheetTitle || activeConfig.spreadsheetId
                    : 'Google Apps Script trên Drive'}
                </strong>
              </span>
              {activeConfig.spreadsheetUrl && (
                <a
                  href={activeConfig.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-emerald-200 underline"
                >
                  <span>Mở Sheet</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}

          {activeTab === 'google' ? (
            <div className="space-y-4">
              {needsAuth ? (
                <div className="rounded-xl border border-[#d9b45a]/40 bg-[#04130e]/70 p-4 text-center">
                  <p className="mb-3 text-sm text-[#e7efe9]">
                    Đăng nhập Google để kết nối bảng tính trên Google Drive. Khi nhập dữ liệu, hệ thống sẽ tự động lưu trực tiếp mà không hiện nút lưu trên màn hình.
                  </p>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isLoggingIn}
                      className="gsi-material-button"
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
                        <span className="gsi-material-button-contents">
                          {isLoggingIn ? 'Đang kết nối...' : 'Sign in with Google'}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d9b45a]/35 bg-[#04130e]/80 px-3.5 py-2.5 text-xs">
                    <div>
                      <span className="text-[#9db3a7]">Tài khoản: </span>
                      <strong className="text-[#fff1c1]">{user?.email || user?.displayName}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const token = await getAccessToken();
                          if (token) await loadDriveFiles(token);
                        }}
                        disabled={isLoadingFiles}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#d9b45a]/40 px-2.5 py-1 text-[#f6e3b0] hover:bg-white/10"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                        <span>Tải lại</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-red-400/40 px-2.5 py-1 text-red-200 hover:bg-red-500/15"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-[#d9b45a]/35 bg-[#04130e]/60 p-3.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#d9b45a]">
                      Bảng tính đích trên Google Drive
                    </label>
                    {spreadsheets.length > 0 && (
                      <select
                        value={selectedSheetId}
                        onChange={(e) => handleSelectSheet(e.target.value)}
                        className="w-full rounded-lg border border-[#d9b45a]/50 bg-[#06261a] px-3 py-2 text-sm text-[#fff1c1] focus:outline-none"
                      >
                        {spreadsheets.map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.name}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customSheetInput}
                        onChange={(e) => setCustomSheetInput(e.target.value)}
                        placeholder="Hoặc dán Link / ID Google Sheet có sẵn..."
                        className="flex-1 rounded-lg border border-[#d9b45a]/40 bg-[#06261a] px-3 py-1.5 text-xs text-white placeholder-[#8aa598] focus:border-[#d9b45a] focus:outline-none sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleSelectSheet(customSheetInput)}
                        disabled={!customSheetInput.trim() || isLoadingFiles}
                        className="cursor-pointer rounded-lg border border-[#d9b45a]/60 bg-[#0b3c2a] px-3 py-1.5 text-xs font-semibold text-[#f6e3b0] hover:bg-[#13513c] disabled:opacity-50"
                      >
                        Chọn Sheet
                      </button>
                    </div>

                    {activeSheetMeta && (
                      <p className="text-xs text-[#b8cec2]">
                        Đang chọn: <strong className="text-[#fff1c1]">{activeSheetMeta.title}</strong> (Trang:{' '}
                        <strong className="text-[#fff1c1]">{activeSheetMeta.firstSheetTitle}</strong>)
                      </p>
                    )}
                  </div>

                  {!confirmMode && (
                    <div className="flex flex-wrap gap-2.5">
                      {selectedSheetId ? (
                        <button
                          type="button"
                          onClick={() => setConfirmMode('google_existing')}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f6e3b0] via-[#d9b45a] to-[#b88a2c] px-4 py-2.5 text-sm font-bold text-[#04130e] shadow-lg hover:brightness-105"
                        >
                          <Check className="h-4 w-4" />
                          <span>Bật tự động lưu vào Sheet này</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setConfirmMode('google_create_new')}
                        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#d9b45a] bg-[#0b3c2a] px-4 py-2.5 text-sm font-semibold text-[#fff1c1] hover:bg-[#13513c]"
                      >
                        <FolderPlus className="h-4 w-4 text-[#d9b45a]" />
                        <span>Tạo Sheet mới &amp; tự động lưu</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#d9b45a]/35 bg-[#04130e]/70 p-3.5 text-xs leading-relaxed text-[#e7efe9] sm:text-sm">
                <p className="font-semibold text-[#fff1c1]">
                  Kết nối tự động lưu vào Google Sheet riêng trên Drive (cài 1 lần):
                </p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                  <li>Mở Google Sheet trên Drive → chọn <strong>Tiện ích mở rộng</strong> → <strong>Apps Script</strong>.</li>
                  <li>Dán mã bên dưới và chọn <strong>Triển khai → Triển khai mới → Ứng dụng web</strong> (Ai có quyền truy cập: <strong>Bất kỳ ai</strong>).</li>
                  <li>Dán đường dẫn Web App vào ô dưới đây để tự động đồng bộ mỗi khi nhập dữ liệu.</li>
                </ol>
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={handleCopyScript}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#d9b45a]/60 bg-[#0b3c2a] px-3 py-1.5 text-xs font-semibold text-[#fff1c1] hover:bg-[#13513c]"
                  >
                    {copiedScript ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedScript ? 'Đã sao chép mã Apps Script' : 'Sao chép mã Apps Script'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#d9b45a]">
                  Đường dẫn Google Apps Script Web App
                </label>
                <input
                  type="url"
                  value={appsScriptUrl}
                  onChange={(e) => setAppsScriptUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full rounded-xl border border-[#d9b45a]/50 bg-[#04130e] px-3.5 py-2.5 text-sm text-white placeholder-[#8aa598] focus:border-[#d9b45a] focus:outline-none"
                />
              </div>

              {!confirmMode && (
                <button
                  type="button"
                  disabled={!appsScriptUrl.trim()}
                  onClick={() => setConfirmMode('apps_script')}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f6e3b0] via-[#d9b45a] to-[#b88a2c] px-4 py-2.5 text-sm font-bold text-[#04130e] shadow-lg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  <span>Bật tự động lưu qua Apps Script</span>
                </button>
              )}
            </div>
          )}

          {/* Mandatory Explicit User Confirmation before mutating/auto-syncing to Drive Sheet */}
          {confirmMode && (
            <div className="rounded-xl border-2 border-[#d9b45a] bg-[#0b3c2a] p-4 shadow-lg">
              <h3 className="text-sm font-bold text-[#fff1c1] sm:text-base">
                Xác nhận bật tự động lưu vào Google Sheet
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[#e7efe9] sm:text-sm">
                {confirmMode === 'google_create_new'
                  ? 'Hệ thống sẽ tạo bảng tính mới "Khai Minh - Dữ Liệu Khách Hàng" trong Google Drive của bạn và tự động ghi, cập nhật dữ liệu mỗi khi bạn nhập.'
                  : confirmMode === 'google_existing'
                  ? `Hệ thống sẽ tự động ghi và cập nhật dữ liệu bạn nhập vào bảng tính "${
                      activeSheetMeta?.title || selectedSheetId
                    }" trên Google Drive.`
                  : 'Hệ thống sẽ tự động gửi và cập nhật dữ liệu bạn nhập vào Google Sheet thông qua đường dẫn Apps Script đã nhập.'}
              </p>
              <div className="mt-3.5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={isActivating}
                  onClick={() => setConfirmMode(null)}
                  className="cursor-pointer rounded-lg border border-white/25 px-4 py-2 text-xs font-semibold text-[#e7efe9] hover:bg-white/10 sm:text-sm"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  disabled={isActivating}
                  onClick={handleConfirmActivate}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#d9b45a] px-4 py-2 text-xs font-bold text-[#04130e] hover:brightness-105 disabled:opacity-60 sm:text-sm"
                >
                  {isActivating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Đang kích hoạt...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Xác nhận bật tự động lưu</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
