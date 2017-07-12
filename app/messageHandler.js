/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Handles parsed/verified messages for DB updates.
 */
var db = require("./database");
var log = require("./logger");
var Query = require('decypher').Query;

function getMergeQuery(message) {
  var query = new Query();
  return query;
}

// Generates a CQL query from the validated message.
// Runs the CQL query. Returns a promise with the result of the query.
module.exports = function(message) {
  var query = getMergeQuery(message);

  return db.query(query.compile(),query.params())
    .then(function(result) {
      log.info("Query successful", uri);
      return true;
    })
    .catch(function(err) {
      log.error("Query failed");
      return false;
    })
  return Promise.resolve(true);
}