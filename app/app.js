/** 
 * Copyright (C) 2017 Menome Technologies Inc.  
 * 
 * A microservice that takes specifically formatted JSON messages and turns them into graph updates.
 */
var express = require("express");
var http = require('http');
var port = process.env.PORT || 3000;
var conf = require('./config');
var rabbitListener = require('./listener'); // For listening to AMQP messages

function fileSyncService(testMode=false) {
  var app = express();
  app.testMode = testMode;

  // An echo endpoint.
  app.get('/', function (req, res, next) {
    return res.send("This is a healthy Data Refinery Service");
  });

  // Listen on the message bus.
  rabbitListener.subscribe();

  return app;
}

///////////////
// Start the App

// If we're not being imported, just run our app.
if (!module.parent) {
  var app = fileSyncService();
  
  http.createServer(app).listen(port);
  console.log("Listening on " + port);
}

module.exports = fileSyncService;