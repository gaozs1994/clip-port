function isTrustedClipportOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "clipport:" && url.host === "app";
  } catch {
    return false;
  }
}

function shouldGrantMediaPermission({ permission, origin, trustedContents, details = {}, phase = "check" }) {
  if (!trustedContents || !isTrustedClipportOrigin(origin)) return false;
  if (permission === "display-capture") return details.isMainFrame !== false;
  if (permission !== "media") return false;
  if (phase === "request") {
    const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    return mediaTypes.includes("audio") && !mediaTypes.includes("video");
  }
  return details.isMainFrame !== false && details.mediaType !== "video";
}

module.exports = { isTrustedClipportOrigin, shouldGrantMediaPermission };
