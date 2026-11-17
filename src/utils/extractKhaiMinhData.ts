export interface ExtractedField {
  key: string;
  section: string;
  label: string;
  value: string;
}

export interface ExtractedKhaiMinhData {
  sessionId: string;
  timestamp: string;
  customerName: string;
  filledCount: number;
  totalFields: number;
  fields: ExtractedField[];
  headers: string[];
  values: string[];
}

const FINANCE_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['khancap', 'Tài khoản Khẩn cấp'],
  ['yte', 'Tài khoản Y tế'],
  ['budap', 'Tài khoản Bù đắp thu nhập'],
  ['benhnang', 'Tài khoản Bệnh nặng'],
  ['giaoduc', 'Tài khoản Giáo dục'],
  ['huutri', 'Tài khoản Hưu trí'],
];

const REALITY_CHIP_LABELS: Record<string, string> = {
  '1': '1: Sinh mạng',
  '2': '2: Sức khỏe',
  '3': '3: Thời gian',
  '4': '4: Cách chi tiêu tiền hợp lý',
};

function getInputValue(doc: Document, selector: string): string {
  const el = doc.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  return el ? el.value.trim() : '';
}

function getTextContent(doc: Document, selector: string): string {
  const el = doc.querySelector(selector);
  return el ? (el.textContent || '').trim() : '';
}

function getCheckedValues(doc: Document, name: string): string {
  const inputs = Array.from(doc.querySelectorAll(`input[name="${name}"]:checked`)) as HTMLInputElement[];
  return inputs.map((i) => i.value.trim()).filter(Boolean).join('; ');
}

export function generateSessionId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `KM-${y}${m}${d}-${rand}`;
}

export function extractKhaiMinhData(
  doc: Document | null | undefined,
  sessionId: string
): ExtractedKhaiMinhData {
  const now = new Date();
  const timestamp = now.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (!doc) {
    return {
      sessionId,
      timestamp,
      customerName: '',
      filledCount: 0,
      totalFields: 0,
      fields: [],
      headers: ['Mã phiên', 'Thời gian lưu'],
      values: [sessionId, timestamp],
    };
  }

  const fields: ExtractedField[] = [];
  const push = (key: string, section: string, label: string, value: string) => {
    fields.push({ key, section, label, value: value.trim() });
  };

  push('sessionId', 'Chung', 'Mã phiên', sessionId);
  push('timestamp', 'Chung', 'Thời gian lưu', timestamp);

  // Tab 1 - Section I: Personal info & time analysis
  const fullName = getInputValue(doc, '#fullName') || getInputValue(doc, '#hoTen');
  const dob = getInputValue(doc, '#dob') || getInputValue(doc, '#ngaySinh');
  push('fullName', 'Bước 1 · I. Thông tin & Thời gian', 'Họ và tên khách hàng', fullName);
  push('dob', 'Bước 1 · I. Thông tin & Thời gian', 'Ngày tháng năm sinh', dob);
  push('retireAge', 'Bước 1 · I. Thông tin & Thời gian', 'Tuổi nghỉ hưu dự kiến', getInputValue(doc, '#retireAge'));
  push('ageDisplay', 'Bước 1 · I. Thông tin & Thời gian', 'Tuổi hiện tại', getTextContent(doc, '#ageDisplay'));
  push('daysUsed', 'Bước 1 · I. Thông tin & Thời gian', 'Số ngày đã sử dụng', getTextContent(doc, '#daysUsed'));
  push('daysRemain', 'Bước 1 · I. Thông tin & Thời gian', 'Số ngày còn lại đến nghỉ hưu', getTextContent(doc, '#daysRemain'));

  // Tab 1 - Income
  push('incMain', 'Bước 1 · Thu nhập', 'Thu nhập chính / tháng', getInputValue(doc, '#incMain'));
  const extraInputs = Array.from(doc.querySelectorAll('#incExtra .incxi')) as HTMLInputElement[];
  const extraIncomeText = extraInputs
    .map((el, idx) => (el.value.trim() ? `Khoản ${idx + 1}: ${el.value.trim()}` : ''))
    .filter(Boolean)
    .join('; ');
  push('incExtra', 'Bước 1 · Thu nhập', 'Các khoản thu nhập thêm / tháng', extraIncomeText);
  push('incMonth', 'Bước 1 · Thu nhập', 'Tổng thu nhập / tháng', getTextContent(doc, '#incMonth'));
  push('incDay', 'Bước 1 · Thu nhập', 'Tổng thu nhập / ngày', getTextContent(doc, '#incDay'));
  push('incYear', 'Bước 1 · Thu nhập', 'Tổng thu nhập / năm', getTextContent(doc, '#incYear'));

  // Tab 1 - Section II: Concerns
  const concernInputs = Array.from(
    doc.querySelectorAll('#tab1 .card:nth-of-type(2) .g4 input[type="text"]')
  ) as HTMLInputElement[];
  for (let i = 0; i < 4; i++) {
    push(
      `concern${i + 1}`,
      'Bước 1 · II. Vấn đề quan tâm',
      `Vấn đề quan tâm ${i + 1}`,
      concernInputs[i]?.value.trim() || ''
    );
  }
  const activeChips = Array.from(doc.querySelectorAll('#chips .cbtn.on')) as HTMLElement[];
  const chipValues = activeChips
    .map((btn) => REALITY_CHIP_LABELS[btn.dataset.n || ''] || btn.dataset.n || '')
    .filter(Boolean)
    .join('; ');
  push('realityConcerns', 'Bước 1 · II. Vấn đề quan tâm', 'Thực tế điều đang quan tâm (1-4)', chipValues);

  // Tab 1 - Section III: Financial analysis table
  for (const [id, name] of FINANCE_CATEGORIES) {
    push(`${id}_t`, 'Bước 1 · III. Phân tích tài chính', `${name} - Mong muốn`, getInputValue(doc, `#${id}_t`));
    push(`${id}_a`, 'Bước 1 · III. Phân tích tài chính', `${name} - Thực tế`, getInputValue(doc, `#${id}_a`));
    push(`${id}_d`, 'Bước 1 · III. Phân tích tài chính', `${name} - Thiếu hụt`, getTextContent(doc, `#${id}_d`));
    push(`${id}_y`, 'Bước 1 · III. Phân tích tài chính', `${name} - Số năm lấp đầy`, getTextContent(doc, `#${id}_y`));
  }
  push('sumTarget', 'Bước 1 · III. Phân tích tài chính', 'Tổng mong muốn', getTextContent(doc, '#sumTarget'));
  push('sumActual', 'Bước 1 · III. Phân tích tài chính', 'Tổng thực tế', getTextContent(doc, '#sumActual'));
  push('sumDeficit', 'Bước 1 · III. Phân tích tài chính', 'Tổng thiếu hụt', getTextContent(doc, '#sumDeficit'));
  push('sumYears', 'Bước 1 · III. Phân tích tài chính', 'Tổng số năm lấp đầy', getTextContent(doc, '#sumYears'));

  // Tab 1 - Section IV: Savings plan
  push('savDay', 'Bước 1 · IV. Kế hoạch tiết kiệm', 'Tiết kiệm / Ngày (VNĐ)', getInputValue(doc, '#savDay'));
  push('savMonth', 'Bước 1 · IV. Kế hoạch tiết kiệm', 'Tiết kiệm / Tháng (VNĐ)', getTextContent(doc, '#savMonth'));
  push('savYear', 'Bước 1 · IV. Kế hoạch tiết kiệm', 'Tiết kiệm / Năm (VNĐ)', getTextContent(doc, '#savYear'));

  // Tab 2 - Section I to VIII
  push('trietLyDauTu', 'Bước 2 · I. Triết lý đầu tư', 'Triết lý đầu tư', getCheckedValues(doc, 'trietLyDauTu'));
  push('quyTaiChinh', 'Bước 2 · II. Quỹ tài chính', 'Quỹ tài chính gia đình quan tâm', getCheckedValues(doc, 'quyTaiChinh'));
  push('target1', 'Bước 2 · III. Mục tiêu tài chính', 'Mục tiêu 1 (VNĐ)', getInputValue(doc, '#target1'));
  push('target2', 'Bước 2 · III. Mục tiêu tài chính', 'Mục tiêu 2 (VNĐ)', getInputValue(doc, '#target2'));
  push('target3', 'Bước 2 · III. Mục tiêu tài chính', 'Mục tiêu 3 (VNĐ)', getInputValue(doc, '#target3'));
  push('totalTarget', 'Bước 2 · III. Mục tiêu tài chính', 'Tổng mục tiêu tài chính (VNĐ)', getTextContent(doc, '#totalTarget'));

  push('giaiPhapBaoVe', 'Bước 2 · IV. Quản trị rủi ro', 'Giải pháp bảo vệ gia đình', getCheckedValues(doc, 'giaiPhapBaoVe'));
  push(
    'giaiPhapBaoVeKhac',
    'Bước 2 · IV. Quản trị rủi ro',
    'Giải pháp bảo vệ khác',
    getInputValue(doc, 'input[name="giaiPhapBaoVeKhac"]')
  );

  push(
    'mocThoiGianDauTu',
    'Bước 2 · V. Mốc thời gian',
    'Mốc thời gian đạt tài sản đầu tư',
    getCheckedValues(doc, 'mocThoiGianDauTu')
  );
  push(
    'mocThoiGianBaoChung',
    'Bước 2 · V. Mốc thời gian',
    'Mốc hoàn tất tài sản bảo chứng',
    getCheckedValues(doc, 'mocThoiGianBaoChung')
  );
  push(
    'thoiDiemBatDau',
    'Bước 2 · VI. Lựa chọn tương lai',
    'Thời điểm mong muốn bắt đầu',
    getCheckedValues(doc, 'thoiDiemBatDau')
  );

  push('hoTen', 'Bước 2 · VII. Thông tin cá nhân', 'Họ & tên (Bước 2)', getInputValue(doc, '#hoTen'));
  push('ngaySinh', 'Bước 2 · VII. Thông tin cá nhân', 'Ngày sinh (Bước 2)', getInputValue(doc, '#ngaySinh'));
  push('gioiTinh', 'Bước 2 · VII. Thông tin cá nhân', 'Giới tính', getCheckedValues(doc, 'gioiTinh'));
  push('ngheNghiep', 'Bước 2 · VII. Thông tin cá nhân', 'Nghề nghiệp', getInputValue(doc, 'input[name="ngheNghiep"]'));
  push('soThich', 'Bước 2 · VII. Thông tin cá nhân', 'Sở thích', getInputValue(doc, 'input[name="soThich"]'));
  push('diaChi', 'Bước 2 · VII. Thông tin cá nhân', 'Địa chỉ', getInputValue(doc, 'input[name="diaChi"]'));
  push('dienThoai', 'Bước 2 · VII. Thông tin cá nhân', 'Điện thoại', getInputValue(doc, 'input[name="dienThoai"]'));
  push('email', 'Bước 2 · VII. Thông tin cá nhân', 'Email', getInputValue(doc, 'input[name="email"]'));
  push(
    'tinhTrangGiaDinh',
    'Bước 2 · VII. Thông tin cá nhân',
    'Tình trạng gia đình',
    getCheckedValues(doc, 'tinhTrangGiaDinh')
  );
  push('soCon', 'Bước 2 · VII. Thông tin cá nhân', 'Số con', getInputValue(doc, 'input[name="soCon"]'));
  push(
    'nguoiPhuThuoc',
    'Bước 2 · VII. Thông tin cá nhân',
    'Người phụ thuộc',
    getInputValue(doc, 'input[name="nguoiPhuThuoc"]')
  );

  push(
    'daNhanThuaKe',
    'Bước 2 · VIII. Thấu hiểu bản thân',
    'Đã từng nhận di sản thừa kế',
    getCheckedValues(doc, 'daNhanThuaKe')
  );
  push('mongMuon1', 'Bước 2 · VIII. Thấu hiểu bản thân', 'Điều mong muốn tiền mang lại 1', getInputValue(doc, 'input[name="mongMuon1"]'));
  push('mongMuon2', 'Bước 2 · VIII. Thấu hiểu bản thân', 'Điều mong muốn tiền mang lại 2', getInputValue(doc, 'input[name="mongMuon2"]'));
  push(
    'nguoiDongHanh',
    'Bước 2 · VIII. Thấu hiểu bản thân',
    'Người đồng hành & hỗ trợ',
    getInputValue(doc, 'input[name="nguoiDongHanh"]')
  );

  const ignoredKeysForCount = new Set([
    'sessionId',
    'timestamp',
    'retireAge',
    'ageDisplay',
    'daysUsed',
    'daysRemain',
    'incMonth',
    'incDay',
    'incYear',
    'khancap_d',
    'khancap_y',
    'yte_d',
    'yte_y',
    'budap_d',
    'budap_y',
    'benhnang_d',
    'benhnang_y',
    'giaoduc_d',
    'giaoduc_y',
    'huutri_d',
    'huutri_y',
    'sumTarget',
    'sumActual',
    'sumDeficit',
    'sumYears',
    'savMonth',
    'savYear',
    'totalTarget',
  ]);

  const filledCount = fields.filter(
    (f) => !ignoredKeysForCount.has(f.key) && f.value !== ''
  ).length;

  return {
    sessionId,
    timestamp,
    customerName: fullName,
    filledCount,
    totalFields: fields.length,
    fields,
    headers: fields.map((f) => f.label),
    values: fields.map((f) => f.value),
  };
}
