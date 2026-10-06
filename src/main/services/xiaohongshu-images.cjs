const fs = require("node:fs");
const path = require("node:path");
const { AppError } = require("./validators.cjs");

function selectXiaohongshuImages(thumbnails = []) {
  const images = new Map();
  for (const thumbnail of Array.isArray(thumbnails) ? thumbnails : []) {
    if (!thumbnail || typeof thumbnail !== "object") continue;
    let url;
    try {
      url = new URL(thumbnail.url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    if (!["xhscdn.com", "xiaohongshu.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) continue;
    url.protocol = "https:";
    // Default and preview URLs share the image path before the CDN transformation suffix.
    const key = url.pathname.split("!")[0];
    const preference = /!nd_dft_/.test(url.pathname) ? 2 : /!nd_prv_/.test(url.pathname) ? 0 : 1;
    const area = (Number(thumbnail.width) || 0) * (Number(thumbnail.height) || 0);
    const previous = images.get(key);
    if (!previous || preference > previous.preference || preference === previous.preference && area > previous.area) {
      images.set(key, { thumbnail: { ...thumbnail, url: url.toString() }, preference, area });
    }
  }
  return [...images.values()].map((image) => image.thumbnail);
}

function prepareImagePackage(directory, thumbnails, expectedCount) {
  const root = path.resolve(directory);
  const downloaded = (Array.isArray(thumbnails) ? thumbnails : []).filter((thumbnail) => {
    if (typeof thumbnail?.filepath !== "string") return false;
    const filename = path.resolve(thumbnail.filepath);
    const relative = path.relative(root, filename);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    try {
      const stats = fs.statSync(filename);
      return /\.png$/i.test(filename) && stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  });
  const images = selectXiaohongshuImages(downloaded);
  if (!images.length || images.length !== expectedCount) {
    throw new AppError("IMAGE_DOWNLOAD_INCOMPLETE", `图片下载不完整（${images.length}/${expectedCount}），请重试或重新解析链接`);
  }
  const imageDirectory = path.join(root, "images");
  fs.mkdirSync(imageDirectory, { recursive: true });
  images.forEach((image, index) => {
    fs.copyFileSync(image.filepath, path.join(imageDirectory, `${String(index + 1).padStart(3, "0")}.png`));
  });
  return imageDirectory;
}

module.exports = { prepareImagePackage, selectXiaohongshuImages };
