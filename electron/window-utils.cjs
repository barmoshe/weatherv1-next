"use strict";

function isLoadableOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() === "") return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && Boolean(parsed.port);
  } catch {
    return false;
  }
}

module.exports = { isLoadableOrigin };
