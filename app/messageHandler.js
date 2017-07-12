/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Handles parsed/verified messages for DB updates.
 */
var db = require("./database");
var log = require("./logger");
var Query = require('decypher').Query;

// This is like JSON.stringify, except property keys are printed without quotes around them
// And we only include properties that are primitives.
function buildObjectStr(obj) {
  var paramStrings = [];

  for(var p in obj) {
    if(typeof obj[p] === 'object' || typeof obj[p] === 'function') 
      continue;
    else if(typeof obj[p] == 'string')
      paramStrings.push(p + ': "'+obj[p]+'"');
    else
      paramStrings.push(p + ': '+obj[p]+'');
  }

  return '{' + paramStrings.join(',') + '}';
}

function getMergeQuery(message) {
  var query = new Query();
  var mergeStmt = "(node:Card:"+message.NodeType+" ";
  mergeStmt += buildObjectStr(message.ConformedDimensions) + ")";
  query.merge(mergeStmt);

  // Get compiled parameters.
  var compiledParams = Object.assign({},message.Properties,message.ConformedDimensions)
  compiledParams.Name = message.Name;
  query.params({nodeParams: compiledParams, newUuid: db.genUuid()});

  query.add("ON CREATE SET node.Uuid = {newUuid}");
  query.set("node += {nodeParams}");

  return query;
}

// Generates a CQL query from the validated message.
// Runs the CQL query. Returns a promise with the result of the query.
module.exports = function(message) {
  var query = getMergeQuery(message);

  return db.query(query.compile(),query.params())
    .then(function(result) {
      log.info("Query successful");
      return true;
    })
    .catch(function(err) {
      log.error("Query failed");
      console.log(err);
      return false;
    })
  return Promise.resolve(true);
}