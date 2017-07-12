/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Connects to rabbitmq and listens for messages harvesters.
 * Handles validation of messages, as well as sending acks and nacks.
 * Calls subroutines for updating the DB.
 */
var conf = require('./config');
var amqp = require('amqplib/callback_api');
var log = require('./logger');
var Ajv = require('ajv');
var models = require('./models');

var messageHandler = require('./messageHandler')

var rabbitConnectInterval;
module.exports = {
  subscribe
}

// Get the validator ready.
var ajv = new Ajv(); // options can be passed, e.g. {allErrors: true} 
var validateMessage = ajv.compile(models.messageSchema);

// Subscribes to the RabbitMQ 
function subscribe() {
  rabbitConnectInterval = setInterval(rabbitConnect, 5000);
  rabbitConnect();
}

function rabbitConnect() {
  log.info("Attempting to connect to RMQ.");
  amqp.connect(conf.rabbit.url, function (err, conn) {
    if (err) return log.error("Failed to connect to RMQ. Will retry: %s", err.message);

    conn.createChannel(function (err, ch) {
      if (err) return log.error("Failed to connect to RMQ. Will retry: %s", err.message);
      ch.assertExchange(conf.rabbit.exchange, 'topic', {
        durable: false
      });

      ch.assertQueue('', {
        exclusive: true
      }, function (err, q) {
        if (err) return log.error("Failed to connect to RMQ. Will retry: %s", err.message);

        log.info("Waiting for messages in %s on exchange '%s'", q.queue, conf.rabbit.exchange);
        ch.bindQueue(q.queue, conf.rabbit.exchange, conf.rabbit.routingKey);
        clearInterval(rabbitConnectInterval); // Stop scheduling this task if it's finished.

        ch.consume(q.queue, function (msg) {
          handleMessage(msg)
            .then(function (result) {
              log.info("Finished with message.")
              if (result) ch.ack(msg);
              else {
                ch.nack(msg, false, false)
              }
            })
            .catch(function (err) {
              log.error(err);
              ch.nack(msg, false, false);
            });
        }, {
          noAck: false
        });
      });
    });
  });
}

// Handles a message. Message should be JSON in a binary blob.
function handleMessage(msg) {
  var parsed = JSON.parse(msg.content);
  var valid = validateMessage(parsed);

  // If the message is invalid, send back false so we nack it.
  if (!valid) {
    console.log("Harvester message was malformed:", validateMessage.errors);
    return Promise.resolve(false);
  }

  return messageHandler(parsed);
}