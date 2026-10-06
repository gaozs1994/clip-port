const COS_RELEASE = Object.freeze({
  bucket: "qcloudtest-1255573942",
  region: "ap-guangzhou",
  prefix: "clipport/windows/x64/",
});
const COS_UPDATE_URL = `https://${COS_RELEASE.bucket}.cos.${COS_RELEASE.region}.myqcloud.com/${COS_RELEASE.prefix}`;
const UPDATE_SOURCES = Object.freeze([
  { name: "COS", options: { provider: "generic", url: COS_UPDATE_URL, useMultipleRangeRequest: false } },
  { name: "GitHub", options: { provider: "github", owner: "gaozs1994", repo: "clip-port" } },
]);

module.exports = { COS_RELEASE, COS_UPDATE_URL, UPDATE_SOURCES };
