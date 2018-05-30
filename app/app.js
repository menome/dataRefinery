/** 
 * Copyright (C) 2018 Menome Technologies Inc.  
 * 
 * A microservice that takes specifically formatted JSON messages and turns them into graph updates.
 */
"use strict";
const Bot = require('@menome/botframework');
const config = require("../config/config.json");
const messageHandler = require("./messageHandler");

// Define the bot itself.
var bot = new Bot({
  config: {
    name: "theLink Data Refinery Service",
    desc: "Converts sync messages into graph updates.",
    ...config
  },
  configSchema: {
    inferDates: {
      doc: "Should we try to infer whether strings are ISO dates, based on a regex?",
      format: "Boolean",
      default: false,
      env: "INFER_DATES"
    },
  }
});

var mh = new messageHandler(bot);

// Listen on the Rabbit queue.
bot.rabbit.addListener('refineryQueue',mh.handleMessage,"harvesterMessage");

bot.start();
bot.changeState({state: "idle"})
