export interface DriveSpreadsheetItem {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  firstSheetTitle: string;
}

const DEFAULT_SPREADSHEET_TITLE = 'Khai Minh - Dữ Liệu Khách Hàng';
const DEFAULT_TAB_TITLE = 'DuLieuKhachHang';

export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) {
    return match[1];
  }
  return trimmed;
}

async function parseErrorResponse(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string } };
    if (data?.error?.message) {
      return `${data.error.message}${data.error.status ? ` (${data.error.status})` : ''}`;
    }
  } catch {
    // ignore JSON parse errors
  }
  return `${fallback} (HTTP ${res.status})`;
}

export async function listAppSpreadsheets(accessToken: string): Promise<DriveSpreadsheetItem[]> {
  const query = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=15&fields=files(id,name,webViewLink,modifiedTime)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, 'Không thể tải danh sách Google Sheet từ Drive'));
  }
  const data = (await res.json()) as { files?: DriveSpreadsheetItem[] };
  return data.files || [];
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseErrorResponse(res, 'Không đọc được thông tin bảng tính Google Sheet'));
  }

  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };

  const firstSheetTitle = data.sheets?.[0]?.properties?.title;
  if (!firstSheetTitle) {
    throw new Error('Bảng tính không có trang tính (sheet tab) hợp lệ.');
  }

  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
    title: data.properties?.title || DEFAULT_SPREADSHEET_TITLE,
    firstSheetTitle,
  };
}

export async function createKhaiMinhSpreadsheet(
  accessToken: string,
  headers: string[],
  title: string = DEFAULT_SPREADSHEET_TITLE
): Promise<SpreadsheetMetadata> {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
        locale: 'vi_VN',
      },
      sheets: [
        {
          properties: {
            title: DEFAULT_TAB_TITLE,
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    throw new Error(await parseErrorResponse(createRes, 'Không thể tạo bảng tính mới trên Google Drive'));
  }

  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };

  const sheetId = created.sheets?.[0]?.properties?.sheetId ?? 0;
  const firstSheetTitle = created.sheets?.[0]?.properties?.title || DEFAULT_TAB_TITLE;

  const headerRange = `${firstSheetTitle}!A1`;
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      created.spreadsheetId
    )}/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: headerRange,
        majorDimension: 'ROWS',
        values: [headers],
      }),
    }
  );

  if (!updateRes.ok) {
    throw new Error(await parseErrorResponse(updateRes, 'Đã tạo Sheet nhưng không thể ghi dòng tiêu đề'));
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      created.spreadsheetId
    )}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.043, green: 0.235, blue: 0.165 },
                  textFormat: {
                    foregroundColor: { red: 0.965, green: 0.89, blue: 0.69 },
                    bold: true,
                  },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
        ],
      }),
    }
  );

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    title: created.properties?.title || title,
    firstSheetTitle,
  };
}

export async function upsertSubmissionToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  headers: string[],
  values: string[],
  knownRowNumber?: number | null
): Promise<{ metadata: SpreadsheetMetadata; rowNumber: number | null }> {
  const metadata = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const tab = metadata.firstSheetTitle;

  if (knownRowNumber && knownRowNumber >= 2) {
    const rowRange = `${tab}!A${knownRowNumber}`;
    const putRowRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(rowRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: rowRange,
          majorDimension: 'ROWS',
          values: [values],
        }),
      }
    );
    if (!putRowRes.ok) {
      throw new Error(await parseErrorResponse(putRowRes, 'Không thể tự động cập nhật dữ liệu vào Google Sheet'));
    }
    return { metadata, rowNumber: knownRowNumber };
  }

  // Ensure header row exists
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(`${tab}!A1:C1`)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!checkRes.ok) {
    throw new Error(await parseErrorResponse(checkRes, 'Không kiểm tra được tiêu đề trong Google Sheet'));
  }

  const checkData = (await checkRes.json()) as { values?: string[][] };
  const hasHeader =
    Array.isArray(checkData.values) && checkData.values.length > 0 && checkData.values[0].length > 0;

  if (!hasHeader) {
    const headerRange = `${tab}!A1`;
    const putRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: headerRange,
          majorDimension: 'ROWS',
          values: [headers],
        }),
      }
    );
    if (!putRes.ok) {
      throw new Error(await parseErrorResponse(putRes, 'Không thể ghi dòng tiêu đề vào Sheet'));
    }
  }

  const appendRange = `${tab}!A1`;
  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: appendRange,
        majorDimension: 'ROWS',
        values: [values],
      }),
    }
  );

  if (!appendRes.ok) {
    throw new Error(await parseErrorResponse(appendRes, 'Không thể ghi dữ liệu mới vào Google Sheet'));
  }

  const appendJson = (await appendRes.json()) as {
    updates?: { updatedRange?: string };
  };
  const updatedRange = appendJson.updates?.updatedRange || '';
  const rowMatch = updatedRange.match(/![A-Z]+(\d+)/);
  const rowNumber = rowMatch?.[1] ? parseInt(rowMatch[1], 10) : null;

  return { metadata, rowNumber };
}

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyevFsT9eAW6BetPEU9NKFPd8RIFuB93f1xGWS--kICs8q7CJrmzBX5aISlX10hvY2h/exec';

export async function sendToAppsScriptWebhook(
  webhookUrl: string,
  headers: string[],
  values: string[]
): Promise<void> {
  const url = webhookUrl.trim();
  if (!url.startsWith('https://script.google.com/')) {
    throw new Error('Đường dẫn Apps Script phải bắt đầu bằng https://script.google.com/...');
  }
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    keepalive: true,
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({ headers, values }),
  });
}

export const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = JSON.parse(e.postData.contents);
  if (sheet.getLastRow() === 0 && data.headers) {
    sheet.appendRow(data.headers);
  }
  if (data.values && data.values.length > 0) {
    var sessionId = data.values[0];
    var lastRow = sheet.getLastRow();
    var targetRow = -1;
    if (sessionId && lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(sessionId)) {
          targetRow = i + 2;
          break;
        }
      }
    }
    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, data.values.length).setValues([data.values]);
    } else {
      sheet.appendRow(data.values);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}`;
