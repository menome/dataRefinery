/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Merges the external config file with environment variables and default config values.
 */
var extConf = require('../config/conf');

var defaults = {
  neo4j: {
    url: 'bolt://neo4j',
    user: 'neo4j',
    pass: 'neo4j'
  },
  rabbit: {
    enable: true,
    url: 'amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600',
    routingKey: 'syncevents.harvester.updates.*',
    exchange: 'syncevents'
  },
  maxConcurrentQueries: 1
}

// Merged external conf and default conf, prioritizing external conf.
var mergedConf = {};
Object.assign(mergedConf, defaults, extConf)

if(process.env.NEO4J_URL) mergedConf.neo4j.url = process.env.NEO4J_URL;
if(process.env.NEO4J_USERNAME) mergedConf.neo4j.user = process.env.NEO4J_USERNAME;
if(process.env.NEO4J_PASSWORD) mergedConf.neo4j.pass = process.env.NEO4J_PASSWORD;

if(process.env.RABBIT_URL) mergedConf.rabbit.url = process.env.RABBIT_URL;

// Export the config.
module.exports = mergedConf;
