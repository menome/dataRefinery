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
    if(typeof obj[p] === 'object' || typeof obj[p] === 'function') continue;
    else if(typeof obj[p] == 'string') paramStrings.push(p + ': "'+obj[p]+'"');
    else paramStrings.push(p + ': '+obj[p]+'');
  }

  return '{' + paramStrings.join(',') + '}';
}

function getMergeQuery(message) {
  var query = new Query();
  var mergeStmt = "(node:Card:"+message.NodeType+" ";
  mergeStmt += buildObjectStr(message.ConformedDimensions) + ")";
  query.merge(mergeStmt);

  query.add("ON CREATE SET node.Uuid = {newUuid}");
  query.set("node += {nodeParams}");

  // Build up another merge/set statement for each connection
  // TODO: Parameters should be subobjects in the main query params. This is not yet possible in neo4j.
  if(Array.isArray(message.Connections))
    message.Connections.forEach((itm,idx) => {
      var nodeName = "node"+idx;
      var newNodeStmt = "("+nodeName+":Card:"+itm.NodeType+" "+buildObjectStr(itm.ConformedDimensions)+")"
      query.merge(newNodeStmt);
      query.add("ON CREATE SET "+nodeName+".Uuid = {"+nodeName+"_newUuid}");
      query.set(nodeName+" += {"+nodeName+"_nodeParams}");
      query.merge("(node)"+(itm.ForwardRel?"":"<")+"-[:"+itm.RelType+"]-"+(itm.ForwardRel?">":"")+"("+nodeName+")")

      var itmParams = Object.assign({},itm.Properties,itm.ConformedDimensions)
      itmParams.Name = itm.Name;
      query.param(nodeName+"_newUuid", db.genUuid());
      query.param(nodeName+"_nodeParams", itmParams)
    });

  // Compile our top-level parameters.
  var compiledParams = Object.assign({},message.Properties,message.ConformedDimensions)
  compiledParams.Name = message.Name;
  compiledParams.SourceSystem = message.SourceSystem ? message.SourceSystem : undefined;
  query.params({nodeParams: compiledParams, newUuid: db.genUuid()});

  return query;
}

function handleMessage(message) {
  var query = getMergeQuery(message);
  return db.query(query.compile(),query.params())
    .then(function(result) {
      log.info("Success for",message.NodeType,"message:",message.Name)
      return true;
    })
    .catch(function(err) {
      log.error("Failure for",message.NodeType,"message:",message.Name);
      log.error(err.toString());
      return false;
    })
}

// Generates a CQL query from the validated message.
// Runs the CQL query. Returns a promise with the result of the query.
module.exports = {
  handleMessage,
  getMergeQuery,
  buildObjectStr
}