/** 
 * Copyright (C) 2017 Menome Technologies Inc.  
 * 
 * A microservice that takes specifically formatted JSON messages and turns them into graph updates.
 */
"use strict";
var bot = require('@menome/botframework')
var messageHandler = require('./messageHandler');
var config = require('./config');

// We only need to do this once. Bot is a singleton.
bot.configure({
  name: "theLink Data Refinery Service",
  desc: "Converts sync messages into graph updates.",
  logging: config.get('logging'),
  port: config.get('port'),
  rabbit: config.get('rabbit'),
  neo4j: config.get('neo4j')
});

// Listen on the Rabbit bus.
bot.rabbitSubscribe('refineryQueue',messageHandler.handleMessage,"harvesterMessage");

// Start the bot.
bot.start();
bot.changeState({state: "idle"})
