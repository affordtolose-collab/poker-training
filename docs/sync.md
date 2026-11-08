# 私人同步：目前未連接

這個網站是 GitHub Pages 上的靜態檔案。Pages 只能讀取公開檔案，不能幫登入使用者寫入私人資料庫。本機的 IndexedDB 和 `localStorage` 助教也讀不到。

因此這一版的自動私人同步是**封鎖的**。介面會一直寫「私人同步尚未連接」。`js/sync.js` 的 `pushRecords` / `pullRecords` 不會發出網路請求。不要把匯出的 JSON、權杖或服務金鑰放進這個公開倉庫、公開 Issue 或公開 Gist。

## 現在就能用的交接方式

1. 在網站的「匯出」下載 JSON。
2. 用你信任的私人管道把檔案交給助教。
3. 檔案格式是 `poker-training.records` 第 1 版。每筆作答都是不可變的；同一 `attemptId` 若內容不同，匯入會整份拒絕。

JSON 會帶題目快照、選項、對錯、講解、決策時間、場次，以及未完成題目已累積的時間。CSV 只給試算表，沒有題目快照。

## 調查結果

倉庫裡沒有伺服器、資料庫、Supabase、Firebase 或現成的登入。這個雲端代理環境只負責建置網站，不是學員的私人資料庫。先前的 GitHub 權杖也不能管理 Pages。這一版沒有建立付費服務，也沒有把任何秘密寫進前端。

## 建議的最小後端

用學員自己的 **Supabase 免費方案**（Postgres + 登入 + Row Level Security）。費用是方案頁上的 $0；建立前請再核對資料庫容量、流量，以及閒置會不會暫停。不要升級付費附加元件。

若不想用 Supabase，另一個同樣先確認免費額度的選法是 Cloudflare Workers + D1。兩邊都還沒有在這個專案裡開通，所以都不能說同步已經可用。

建議的資料表：

```sql
create table public.attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt_id text not null,
  body jsonb not null,
  inserted_at timestamptz not null default now(),
  primary key (user_id, attempt_id)
);

alter table public.attempts enable row level security;

create policy "own rows"
  on public.attempts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

網站只應使用 anon key 加上該使用者的登入階段，而且要等後端真的建成、測過之後才設定。Service role 不能放進前端。助教讀取要用另一組**只讀、只限這個使用者**的憑證，由私人管道交給助教，不進 git。

匯入匯出的 JSON 就是以後同步的內容。對應的最小 API：

- `GET /v1/me/attempts`：回傳該使用者的 `poker-training.records`
- `POST /v1/me/attempts`：只新增。相同 `attemptId` 且內容不同時回 409，不可覆蓋

## 需要的下一個決定

請選擇其中一項，再做下一輪實作。這一輪不會自行開通服務：

1. 同意用你自己的帳號建立 Supabase 免費專案，並在之後用私人方式提供 Project URL 與 anon key；助教的唯讀憑證另外給。
2. 改為 Cloudflare Workers + D1，同樣由你建立免費資源。
3. 維持只靠 JSON 匯出，不接自動同步。
