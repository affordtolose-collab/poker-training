export function syncStatus() {
  return {
    mode: "local-only",
    automaticSync: false,
    connected: false,
    blocked: true,
    code: "NO_PRIVATE_BACKEND",
    message: "私人同步尚未連接。紀錄只在這台瀏覽器，助教讀不到，除非你自己匯出 JSON。",
  };
}

export async function pushRecords() {
  return { ok: false, ...syncStatus() };
}

export async function pullRecords() {
  return { ok: false, ...syncStatus() };
}
