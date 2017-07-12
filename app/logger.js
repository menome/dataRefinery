/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Logging wrapper.
 */
module.exports = {
  info: function(msg, ...args) {
    console.log("[INFO] "+msg, ...args);
  },
  error: function(msg, ...args) {
    console.error("[ERROR] "+msg, ...args);
  }
}