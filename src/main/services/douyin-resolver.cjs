const crypto = require("node:crypto");
const { AppError, assertHttpUrl } = require("./validators.cjs");

const SHARE_ORIGIN = "https://www.iesdouyin.com";
const MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const COMMON_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

function isDouyinUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["douyin.com", "iesdouyin.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function extractVideoId(value) {
  try {
    const pathname = new URL(value).pathname;
    return pathname.match(/\/(?:share\/)?video\/(\d{8,30})(?:\/|$)/)?.[1] || "";
  } catch {
    return "";
  }
}

function readAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function findElement(html, id) {
  for (const match of html.matchAll(/<[^>]+>/g)) {
    if (readAttribute(match[0], "id") === id) return match[0];
  }
  return "";
}

function cookieHeader(response) {
  const setCookies = typeof response.headers?.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  const pairs = setCookies
    .map((value) => String(value).split(";", 1)[0])
    .filter((value) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[^;\r\n]*$/.test(value));
  if (pairs.length) return pairs.join("; ");

  const combined = response.headers?.get?.("set-cookie") || "";
  const ttwid = combined.match(/(?:^|[,;]\s*)ttwid=([^;,\r\n]+)/i)?.[1];
  return ttwid ? `ttwid=${ttwid}` : "";
}

function encryptReflowToken(webId, token) {
  const key = Buffer.from(webId.slice(0, 16), "utf8");
  if (key.length !== 16 || !token) {
    throw new AppError("DOUYIN_PAGE_CHANGED", "抖音分享页缺少解析令牌");
  }
  const cipher = crypto.createCipheriv("aes-128-cbc", key, key);
  return Buffer.concat([cipher.update(token, "utf8"), cipher.final()]).toString("base64");
}

function requestedHeight(resolution, sourceHeight) {
  const maximum = Number(sourceHeight) || 720;
  const requested = resolution === "best" ? maximum : Number(resolution) || maximum;
  return COMMON_HEIGHTS.find((height) => height <= Math.min(requested, maximum)) || Math.min(maximum, 360);
}

function directVideoUrl(value, resolution, sourceHeight) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new AppError("DOUYIN_INVALID_MEDIA", "抖音返回了不安全的媒体地址");
  url.pathname = url.pathname.replace(/\/playwm\//i, "/play/");
  url.searchParams.set("ratio", `${requestedHeight(resolution, sourceHeight)}p`);
  return url.toString();
}

function uploadDate(timestamp) {
  const milliseconds = Number(timestamp) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  return new Date(milliseconds).toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeDouyinInfo(result, thumbnailDataUrl = "") {
  return {
    id: result.id,
    title: result.title,
    uploader: result.uploader,
    extractor: "Douyin",
    duration: result.duration,
    uploadDate: result.uploadDate,
    webpageUrl: result.webpageUrl,
    liveStatus: "not_live",
    thumbnailDataUrl,
    best: {
      height: result.height,
      fps: result.fps,
      container: "mp4",
      videoCodec: "H.264",
      audioCodec: "AAC",
      estimatedBytes: null,
    },
    availableHeights: result.availableHeights,
    subtitleLanguages: [],
    hasManualSubtitles: false,
    hasAutomaticSubtitles: false,
    downloadStrategy: "douyin-share",
  };
}

function buildYtDlpInfo(result) {
  return {
    _type: "video",
    id: result.id,
    title: result.title,
    uploader: result.uploader,
    duration: result.duration,
    upload_date: result.uploadDate,
    webpage_url: result.webpageUrl,
    extractor: "DouyinShare",
    extractor_key: "DouyinShare",
    thumbnail: result.thumbnailUrl,
    thumbnails: result.thumbnailUrl ? [{ url: result.thumbnailUrl }] : [],
    formats: [{
      format_id: `${result.height || 720}p`,
      format_note: "Douyin share",
      url: result.downloadUrl,
      ext: "mp4",
      protocol: "https",
      width: result.width,
      height: result.height,
      fps: result.fps,
      vcodec: "avc1",
      acodec: "mp4a",
      http_headers: {
        "User-Agent": MOBILE_USER_AGENT,
        Referer: result.webpageUrl,
      },
    }],
  };
}

class DouyinResolver {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetch(url, { redirect: "follow", ...options, signal: controller.signal });
    } catch (error) {
      const message = error?.name === "AbortError" ? "请求超时" : "网络请求失败";
      throw new AppError("DOUYIN_NETWORK_ERROR", `抖音解析${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async #text(response, label) {
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > MAX_RESPONSE_BYTES) throw new AppError("DOUYIN_RESPONSE_TOO_LARGE", `${label}响应过大`);
    const value = await response.text();
    if (Buffer.byteLength(value, "utf8") > MAX_RESPONSE_BYTES) {
      throw new AppError("DOUYIN_RESPONSE_TOO_LARGE", `${label}响应过大`);
    }
    return value;
  }

  async resolve(rawUrl, options = {}) {
    const retryable = new Set([
      "DOUYIN_NETWORK_ERROR",
      "DOUYIN_PAGE_UNAVAILABLE",
      "DOUYIN_PAGE_CHANGED",
      "DOUYIN_DETAIL_UNAVAILABLE",
      "DOUYIN_PROTOCOL_ERROR",
    ]);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.#resolveOnce(rawUrl, options);
      } catch (error) {
        lastError = error;
        if (attempt > 0 || !retryable.has(error?.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw lastError;
  }

  async #resolveOnce(rawUrl, { resolution = "best" } = {}) {
    const sourceUrl = assertHttpUrl(rawUrl);
    if (!isDouyinUrl(sourceUrl)) throw new AppError("UNSUPPORTED_URL", "不是可识别的抖音链接");

    let videoId = extractVideoId(sourceUrl);
    if (!videoId) {
      const redirectResponse = await this.#request(sourceUrl, { headers: { "User-Agent": MOBILE_USER_AGENT } });
      videoId = extractVideoId(redirectResponse.url);
      await redirectResponse.body?.cancel?.().catch?.(() => {});
    }
    if (!videoId) throw new AppError("DOUYIN_LINK_INVALID", "未能从抖音分享链接识别视频编号");

    const webpageUrl = `${SHARE_ORIGIN}/share/video/${videoId}`;
    const pageResponse = await this.#request(webpageUrl, { headers: { "User-Agent": MOBILE_USER_AGENT } });
    if (!pageResponse.ok) throw new AppError("DOUYIN_PAGE_UNAVAILABLE", "抖音分享页暂时不可访问");
    const cookies = cookieHeader(pageResponse);
    const html = await this.#text(pageResponse, "分享页");

    const webIdTag = findElement(html, "douyin_reflow_webId");
    const tokenTag = findElement(html, "douyin_reflow_token");
    const webId = readAttribute(webIdTag, "webId");
    const userCip = readAttribute(webIdTag, "usercip");
    const xsToken = readAttribute(tokenTag, "xsstoken");
    if (!/^\d{16,24}$/.test(webId) || !/^[A-Za-z0-9_-]{16,512}$/.test(xsToken)) {
      throw new AppError("DOUYIN_PAGE_CHANGED", "抖音分享页结构已变化，请稍后重试");
    }

    const params = new URLSearchParams({
      reflow_source: "reflow_page",
      web_id: webId,
      device_id: webId,
      user_cip: userCip,
      use_new_select_scope: "0",
      item_ids: videoId,
      reflow_id: encryptReflowToken(webId, xsToken),
    });
    const detailResponse = await this.#request(`${SHARE_ORIGIN}/web/api/v2/aweme/iteminfo/?${params}`, {
      headers: {
        "User-Agent": MOBILE_USER_AGENT,
        Referer: webpageUrl,
        "Content-Type": "application/json",
        "Agw-Js-Conv": "str",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    if (!detailResponse.ok) throw new AppError("DOUYIN_DETAIL_UNAVAILABLE", "抖音视频详情暂时不可访问");

    let payload;
    try {
      payload = JSON.parse(await this.#text(detailResponse, "视频详情"));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("DOUYIN_PROTOCOL_ERROR", "抖音返回了无法识别的视频信息");
    }
    const item = payload?.item_list?.find((entry) => String(entry?.aweme_id) === videoId) || payload?.item_list?.[0];
    const playUrl = item?.video?.play_addr?.url_list?.find((value) => typeof value === "string" && value.startsWith("https://"));
    if (Number(payload?.status_code) !== 0 || !item || !playUrl) {
      throw new AppError("DOUYIN_VIDEO_UNAVAILABLE", "该抖音视频当前不可解析，可能已删除、设为私密或受地区限制");
    }

    const height = Number(item.video?.height) || 720;
    const width = Number(item.video?.width) || null;
    const selectedHeight = requestedHeight(resolution, height);
    return {
      id: String(item.aweme_id || videoId),
      title: String(item.desc || `抖音视频 ${videoId}`).trim(),
      uploader: String(item.author?.nickname || "抖音用户"),
      duration: Number.isFinite(Number(item.video?.duration)) ? Number(item.video.duration) / 1000 : null,
      uploadDate: uploadDate(item.create_time),
      webpageUrl,
      thumbnailUrl: item.video?.cover?.url_list?.find((value) => typeof value === "string" && value.startsWith("https://")) || "",
      downloadUrl: directVideoUrl(playUrl, resolution, height),
      width: width && height ? Math.round(width * selectedHeight / height) : width,
      height: selectedHeight,
      fps: 30,
      availableHeights: COMMON_HEIGHTS.filter((value) => value <= height),
    };
  }
}

module.exports = {
  DouyinResolver,
  MOBILE_USER_AGENT,
  buildYtDlpInfo,
  extractVideoId,
  isDouyinUrl,
  normalizeDouyinInfo,
};
