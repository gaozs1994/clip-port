const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { prepareImagePackage, selectXiaohongshuImages } = require("../src/main/services/xiaohongshu-images.cjs");

const imageUrl = (id, variant = "dft") => `https://sns-webpic-qc.xhscdn.com/spectrum/${id}!nd_${variant}_webp`;

test("selects default images over preview variants and excludes unsafe image URLs", () => {
  const images = selectXiaohongshuImages([
    { url: imageUrl("one", "prv"), id: "preview" },
    { url: imageUrl("one"), id: "default" },
    { url: "http://sns-webpic-bd.xhscdn.com/spectrum/two!nd_dft_webp", id: "second" },
    { url: "https://example.com/untrusted.png" },
    { url: "https://secret@sns-webpic-qc.xhscdn.com/private.png" },
    { url: "file:///C:/private.png" },
    { url: "https://xhscdn.com.example.com/private.png" },
    { url: "not-a-url" },
    null,
  ]);
  assert.deepEqual(images.map((image) => image.id), ["default", "second"]);
  assert.match(images[1].url, /^https:/);
});

test("packages one downloaded PNG per image with numbered filenames", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-images-"));
  try {
    const thumbnails = [["preview", "one", "prv"], ["default", "one", "dft"], ["second", "two", "dft"]].map(([name, id, variant]) => {
      const filepath = path.join(directory, `${name}.png`);
      fs.writeFileSync(filepath, name);
      return { url: imageUrl(id, variant), filepath };
    });
    const sourceDirectory = prepareImagePackage(directory, thumbnails, 2);
    assert.deepEqual(fs.readdirSync(sourceDirectory), ["001.png", "002.png"]);
    assert.equal(fs.readFileSync(path.join(sourceDirectory, "001.png"), "utf8"), "default");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails incomplete downloads and refuses files outside the staging directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-images-missing-"));
  try {
    const staging = path.join(directory, "staging");
    fs.mkdirSync(staging);
    const outside = path.join(directory, "outside.png");
    const inside = path.join(staging, "inside.png");
    fs.writeFileSync(outside, "outside");
    fs.writeFileSync(inside, "inside");
    assert.throws(() => prepareImagePackage(staging, [{ url: imageUrl("one"), filepath: outside }], 1), { code: "IMAGE_DOWNLOAD_INCOMPLETE" });
    assert.throws(() => prepareImagePackage(staging, [{ url: imageUrl("one"), filepath: inside }], 2), { code: "IMAGE_DOWNLOAD_INCOMPLETE" });
    assert.equal(fs.existsSync(path.join(staging, "images")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
