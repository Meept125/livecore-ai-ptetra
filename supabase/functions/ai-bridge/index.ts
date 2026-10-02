// supabase/functions/ai-bridge/index.ts
//
// LiveCore AI — cầu nối gọi AI thật (Google Gemini) cho bản deploy tĩnh (GitHub Pages).
// Dùng Gemini vì Google AI Studio cấp API key MIỄN PHÍ (không cần thẻ thanh toán) với
// hạn mức hằng ngày đủ cho demo/đồ án — khác với Anthropic, chỉ có ít credit dùng thử
// rồi phải trả phí. Giữ GEMINI_API_KEY ở phía server (secret của Supabase), không bao
// giờ để lộ key ra trình duyệt.
//
// Bắt buộc người gọi phải là tài khoản Supabase đã đăng nhập (JWT hợp lệ) — tránh việc
// người lạ ghé trang public rồi gọi tràn lan, dễ chạm hạn mức miễn phí trong ngày.
//
// Lấy key miễn phí tại: https://aistudio.google.com/apikey (đăng nhập bằng tài khoản Google,
// bấm "Create API key" — không cần nhập thẻ). Xem hạn mức miễn phí hiện tại (số lượt/phút,
// số lượt/ngày) tại https://ai.google.dev/gemini-api/docs/rate-limits, mục "Free tier".
//
// Triển khai (từ máy có Supabase CLI, đã `supabase login` và `supabase link`):
//   supabase functions deploy ai-bridge --no-verify-jwt
//   supabase secrets set GEMINI_API_KEY=AIzaSy-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Ghi chú --no-verify-jwt: hàm tự kiểm tra JWT bằng tay bên dưới (để phân biệt rõ lỗi
// "chưa đăng nhập" và trả lời đúng định dạng JSON mà app cần), nên tắt lớp verify JWT
// mặc định của Supabase Edge Functions.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// Cả hai đều là model "flash" (rẻ/nhanh, nằm trong hạn mức miễn phí của Google AI Studio).
// Kiểm tra tên model mới nhất tại https://ai.google.dev/gemini-api/docs/models trước khi
// deploy, vì Google thỉnh thoảng đổi tên/khai tử bản cũ — đây chính là nguyên nhân phổ biến
// nhất gây lỗi "Kết nối AI bị gián đoạn / HTTP 502: upstream_error" trên LiveCore AI: Gemini
// trả 404 "model not found" cho model đã bị khai tử, rồi ai-bridge gom lỗi đó vào nhóm
// upstream_error chung. (Cập nhật 09/2026: gemini-2.0-flash và gemini-2.0-flash-lite ĐÃ bị
// Google khai tử hẳn — nếu gặp lại lỗi này sau này, khả năng cao là 2 model bên dưới cũng
// đã bị thay thế, hãy vào trang docs/models kiểm tra rồi sửa lại 2 dòng dưới.)
const MODEL_QUICK = "gemini-3.5-flash-lite";
const MODEL_DEFAULT = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Chuyển video/audio thành văn bản (mode "media"): file tải lên trực tiếp (inline_data, base64)
// hoặc link video (YouTube qua file_data.file_uri, hoặc link trực tiếp được tải về ở đây rồi
// gửi dạng inline_data). 8MB là mức bạn đã chọn cho bản demo — sửa hai số dưới nếu muốn đổi,
// nhưng nhớ đối chiếu với giới hạn kích thước request hiện tại của Supabase Edge Functions
// (có thể đã thay đổi theo thời gian) trước khi tăng lên nhiều.
const MEDIA_RAW_CAP = 8 * 1024 * 1024; // ~8MB dữ liệu gốc
const MEDIA_B64_CAP = Math.ceil((MEDIA_RAW_CAP * 4) / 3) + 1024; // base64 nặng hơn ~33%
const DEFAULT_TRANSCRIBE_PROMPT =
  "Hãy nghe và chuyển toàn bộ lời nói trong video/audio này thành văn bản tiếng Việt đầy đủ, đúng chính tả, không thêm bình luận hay tóm tắt.";

function isYouTubeUrl(u: string) {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/i.test(u);
}

// Tải một link video/audio trực tiếp (KHÔNG phải YouTube) về ngay trên server để gửi cho Gemini —
// làm ở đây vì trình duyệt của người dùng thường bị CORS chặn khi tải chéo domain. Có vài lớp
// chặn cơ bản (chỉ http/https, chặn địa chỉ nội bộ, giới hạn thời gian và kích thước) để tránh
// bị lợi dụng làm cầu nối quét mạng nội bộ hoặc tải file khổng lồ.
async function fetchMediaUrl(urlStr: string): Promise<{ b64: string; mime: string }> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    const e: any = new Error("Link không hợp lệ.");
    e.status = 400;
    throw e;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    const e: any = new Error("Chỉ chấp nhận link http hoặc https.");
    e.status = 400;
    throw e;
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host === "0.0.0.0" || host.endsWith(".local") ||
    /^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  ) {
    const e: any = new Error("Link trỏ vào địa chỉ nội bộ, không được phép.");
    e.status = 400;
    throw e;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r: Response;
  try {
    r = await fetch(u.toString(), { signal: ctrl.signal, redirect: "follow" });
  } catch {
    clearTimeout(timer);
    const e: any = new Error("Không tải được video/audio từ link này (mạng lỗi hoặc link chặn truy cập).");
    e.status = 502;
    throw e;
  }
  if (!r.ok) {
    clearTimeout(timer);
    const e: any = new Error(`Link trả về lỗi HTTP ${r.status}.`);
    e.status = 502;
    throw e;
  }
  const lenHeader = r.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MEDIA_RAW_CAP) {
    clearTimeout(timer);
    const e: any = new Error(`File tại link này vượt quá giới hạn ~${MEDIA_RAW_CAP / 1024 / 1024}MB cho phép.`);
    e.status = 400;
    throw e;
  }
  const reader = r.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    const e: any = new Error("Không đọc được nội dung từ link này.");
    e.status = 502;
    throw e;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MEDIA_RAW_CAP) {
          ctrl.abort();
          const e: any = new Error(`File tại link này vượt quá giới hạn ~${MEDIA_RAW_CAP / 1024 / 1024}MB cho phép.`);
          e.status = 400;
          throw e;
        }
        chunks.push(value);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  const mime = r.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return { b64: btoa(bin), mime };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function stripFence(s: string) {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (m ? m[1] : s).trim();
}

function extractJson(text: string) {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fallthrough */
      }
    }
    return null;
  }
}

// Gọi Gemini generateContent. `contents` đã ở đúng định dạng Gemini
// ([{role:'user'|'model', parts:[...]}]). `systemInstruction` tuỳ chọn.
async function callGemini(
  model: string,
  contents: unknown[],
  opts: { systemInstruction?: string; maxOutputTokens?: number } = {},
) {
  const url = `${API_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: opts.maxOutputTokens ?? 400, temperature: 0.7 },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j: any = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    const err: any = new Error("gemini_error");
    err.status = r.status;
    err.detail = j || t;
    throw err;
  }
  const cand = j?.candidates?.[0];
  if (cand?.finishReason === "SAFETY" || cand?.finishReason === "RECITATION") {
    const err: any = new Error("blocked");
    err.status = 422;
    err.detail = cand.finishReason;
    throw err;
  }
  const text = (cand?.content?.parts || [])
    .map((p: any) => p.text || "")
    .join("");
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!GEMINI_API_KEY) {
    return json({ error: "server_misconfigured", message: "Chưa đặt GEMINI_API_KEY trên Supabase." }, 500);
  }

  // 1) Bắt buộc đăng nhập Supabase thật (không chấp nhận chỉ có khóa anon) —
  //    vẫn cần bước này dù Gemini miễn phí, để một người không dùng hết hạn mức
  //    trong ngày của cả nhóm.
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not_granted", message: "Thiếu token đăng nhập." }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json({ error: "not_granted", message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." }, 401);
  }

  // 2) Đọc và giới hạn dữ liệu vào để tránh lạm dụng / chạm hạn mức miễn phí ngoài ý muốn
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Body không phải JSON hợp lệ." }, 400);
  }
  const mode = body?.mode === "chat" ? "chat" : body?.mode === "media" ? "media" : "json";
  const modelTier = body?.modelTier === "default" ? "default" : "quick";
  const model = modelTier === "default" ? MODEL_DEFAULT : MODEL_QUICK;
  const images = Array.isArray(body?.images) ? body.images.slice(0, 3) : [];
  if (images.some((im: any) => typeof im?.data !== "string" || im.data.length > 6_000_000)) {
    return json({ error: "bad_request", message: "Ảnh quá lớn hoặc không hợp lệ." }, 400);
  }

  try {
    if (mode === "media") {
      const prompt = String(body?.prompt || DEFAULT_TRANSCRIBE_PROMPT).slice(0, 2000);
      const media = body?.media;
      const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
      let parts: any[];
      if (media) {
        if (typeof media.data !== "string" || media.data.length > MEDIA_B64_CAP) {
          return json({ error: "bad_request", message: `File quá lớn hoặc không hợp lệ (tối đa ~${MEDIA_RAW_CAP / 1024 / 1024}MB).` }, 400);
        }
        parts = [{ inline_data: { mime_type: media.mime || "video/mp4", data: media.data } }, { text: prompt }];
      } else if (mediaUrl) {
        if (isYouTubeUrl(mediaUrl)) {
          // Gemini có thể tự lấy video YouTube công khai qua file_data.file_uri, không cần tải về ở đây.
          // Nếu tính năng này bị Google thay đổi/khai tử, lỗi sẽ hiện ra qua nhánh catch bên dưới —
          // kiểm tra https://ai.google.dev/gemini-api/docs/video-understanding khi gặp lỗi lạ ở link YouTube.
          parts = [{ file_data: { file_uri: mediaUrl, mime_type: "video/*" } }, { text: prompt }];
        } else {
          let fetched: { b64: string; mime: string };
          try {
            fetched = await fetchMediaUrl(mediaUrl);
          } catch (e: any) {
            return json({ error: "fetch_failed", message: e?.message || "Không tải được nội dung từ link." }, e?.status || 502);
          }
          parts = [{ inline_data: { mime_type: fetched.mime, data: fetched.b64 } }, { text: prompt }];
        }
      } else {
        return json({ error: "bad_request", message: "Thiếu media hoặc mediaUrl." }, 400);
      }
      const text = await callGemini(model, [{ role: "user", parts }], { maxOutputTokens: 2048 });
      return json({ text });
    }

    if (mode === "chat") {
      const turns = Array.isArray(body?.turns) ? body.turns.slice(-12) : [];
      if (!turns.length) return json({ error: "bad_request", message: "Thiếu turns." }, 400);
      const contents = turns
        .filter((t: any) => (t?.role === "user" || t?.role === "assistant") && typeof t?.content === "string")
        .map((t: any) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: String(t.content).slice(0, 6000) }],
        }));
      const text = await callGemini(model, contents, { maxOutputTokens: 300 });
      return json({ text });
    }

    // mode === 'json'
    const prompt = String(body?.prompt || "").slice(0, 4000);
    if (!prompt) return json({ error: "bad_request", message: "Thiếu prompt." }, 400);
    const parts: any[] = images.map((im: any) => ({
      inline_data: { mime_type: im.mime || "image/jpeg", data: im.data },
    }));
    parts.push({ text: prompt });
    const text = await callGemini(model, [{ role: "user", parts }], {
      systemInstruction:
        "Chỉ trả lời bằng JSON hợp lệ theo đúng định dạng được yêu cầu trong tin nhắn của người dùng. Không thêm lời giải thích, không thêm markdown code fence.",
      maxOutputTokens: 800,
    });
    const data = extractJson(text);
    if (data === null) return json({ error: "parse_failed", raw: text.slice(0, 500) }, 502);
    return json({ data });
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) {
      return json({ error: "upstream_auth", message: "GEMINI_API_KEY sai, bị thu hồi, hoặc chưa bật Gemini API cho project." }, 502);
    }
    if (e?.status === 404) {
      return json({
        error: "model_not_found",
        message: `Model "${model}" không còn tồn tại hoặc chưa hỗ trợ (Google đổi tên/khai tử model theo thời gian). Vào https://ai.google.dev/gemini-api/docs/models lấy tên model hiện tại rồi sửa MODEL_QUICK/MODEL_DEFAULT trong ai-bridge, deploy lại.`,
        detail: e?.detail,
      }, 502);
    }
    if (e?.status === 400) {
      return json({ error: "upstream_bad_request", message: "Gemini từ chối yêu cầu (sai định dạng, hoặc API key chưa bật đúng dịch vụ).", detail: e?.detail }, 502);
    }
    if (e?.status === 429) return json({ error: "rate_limited", message: "Đã chạm hạn mức miễn phí của Gemini, thử lại sau ít phút." }, 429);
    if (e?.status === 422) return json({ error: "blocked", message: "Gemini từ chối trả lời nội dung này." }, 502);
    return json({ error: "upstream_error", message: "Không gọi được Gemini vì lý do không xác định (xem detail).", detail: e?.detail || String(e) }, 502);
  }
});
