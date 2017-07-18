/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Connects to rabbitmq and listens for messages harvesters.
 * Handles validation of messages, as well as sending acks and nacks.
 * Calls subroutines for updating the DB.
 */
var conf = require('./config');
var amqp = require('amqplib');
var log = require('./logger');
var Ajv = require('ajv');
var models = require('./models');

var messageHandler = require('./messageHandler')

var rabbitConnectInterval;
module.exports = {
  subscribe,
  handleMessage
}

// Get the validator ready.
var ajv = new Ajv(); // options can be passed, e.g. {allErrors: true} 
var validateMessage = ajv.compile(models.messageSchema);
var rabbitChannel;

// Subscribes to the RabbitMQ 
function subscribe() {
  rabbitConnectInterval = setInterval(rabbitConnect, 5000);
  rabbitConnect();
}

function rabbitConnect() {
  log.info("Attempting to connect to RMQ.");

  log.info("Attempting to connect to RMQ.");
  amqp.connect(conf.rabbit.url)
    .then(function(conn) {
      conn.on('error', function(err) {
        conn.close();
        rabbitChannel = null;
        rabbitConnectInterval = setInterval(rabbitConnect, 5000);
      });
      log.info("Connected to RMQ");
      return conn.createChannel();
    })
    .then(function(channel) {
      log.info("Created channel")
      clearInterval(rabbitConnectInterval); // Stop scheduling this task if it's finished.
      rabbitChannel = channel;
      rabbitChannel.prefetch(conf.maxConcurrentQueries); // Set prefetch count.
      channel.assertExchange(conf.rabbit.exchange, 'topic', {durable: true});
      return channel.assertQueue('', {exclusive: true})
    })
    .then(function(q) {
      log.info("Waiting for messages in %s on exchange '%s'", q.queue, conf.rabbit.exchange);
      rabbitChannel.bindQueue(q.queue, conf.rabbit.exchange, conf.rabbit.routingKey);
      clearInterval(rabbitConnectInterval); // Stop scheduling this task if it's finished.
      rabbitChannel.consume(q.queue, function (msg) {
        handleMessage(msg)
          .then(function (result) {
            if (result) rabbitChannel.ack(msg);
            else {
              rabbitChannel.nack(msg, false, false)
            }
          })
          .catch(function (err) {
            log.error(err);
            rabbitChannel.nack(msg, false, false);
          });
      }, {
        noAck: false
      });
    })
    .catch((err) => {
      log.error("Failed to connect to RMQ. Will retry: %s", err.message);
    });
}

// Handles a message. Message should be JSON in a binary blob.
function handleMessage(msg) {
  var parsed = {};

  try {
    parsed = JSON.parse(msg.content);
  }
  catch(ex) {
    log.error("Malformed JSON in message");
    return Promise.resolve(false);
  }
  
  var valid = validateMessage(parsed);

  // If the message is invalid, send back false so we nack it.
  if (!valid) {
    log.error("Harvester message was malformed:", validateMessage.errors);
    console.log(parsed.Name)
    return Promise.resolve(false);
  }

  return messageHandler.handleMessage(parsed);
}