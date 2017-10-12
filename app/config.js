/**
 * Copyright (c) 2017 Menome Technologies Inc.
 * Configuration for the bot
 */
"use strict";
var convict = require('convict');
var fs = require('fs');
var bot = require('@menome/botframework')

var config = convict({
  port: bot.configSchema.port,
  logging: bot.configSchema.logging,
  rabbit: bot.configSchema.rabbit,
  neo4j: bot.configSchema.neo4j,
})

// Load from file.
if (fs.existsSync('./config/config.json')) {
  config.loadFile('./config/config.json');
}

// Export the config.
module.exports = config;