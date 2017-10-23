/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Handles parsed/verified messages for DB updates.
 */
var bot = require('@menome/botframework')
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

function getMergeQuery(message,queryProps) {
  var query = new Query();
  var objectStr = buildObjectStr(message.ConformedDimensions);
  if(objectStr === "{}") return false; // Don't run the query if our conformedDimensions is too small. (Should be caught in the schema. This is just paranoia.)
  var mergeStmt = "(node:Card:"+message.NodeType+" " + objectStr + ")";
  query.merge(mergeStmt);

  query.add("ON CREATE SET node.Uuid = {newUuid}");
  query.set("node += {nodeParams}");

  // Build up another merge/set statement for each connection
  // TODO: Parameters should be subobjects in the main query params. This is not yet possible in neo4j.
  if(Array.isArray(message.Connections)) {
    message.Connections.forEach((itm,idx) => {
      var nodeName = "node"+idx;
      var newNodeStmt = "("+nodeName+":Card:"+itm.NodeType+" "+buildObjectStr(itm.ConformedDimensions)+")"
      query.merge(newNodeStmt);
      query.add("ON CREATE SET "+nodeName+".Uuid = {"+nodeName+"_newUuid}, "+nodeName+".PendingMerge = true");
      query.set(nodeName+" += {"+nodeName+"_nodeParams}");
      query.merge("(node)"+(itm.ForwardRel?"":"<")+"-["+nodeName+"_rel:"+itm.RelType+"]-"+(itm.ForwardRel?">":"")+"("+nodeName+")")
      query.set(nodeName+"_rel += {"+nodeName+"_relProps}")

      var itmParams = Object.assign({},itm.Properties,itm.ConformedDimensions)
      itmParams.Name = itm.Name;
      query.param(nodeName+"_newUuid", bot.genUuid());
      query.param(nodeName+"_nodeParams", itmParams);
      query.param(nodeName+"_relProps", itm.RelProps ? itm.RelProps : {})
    });
  }

  // Compile our top-level parameters.
  var compiledParams = Object.assign({},queryProps.Properties,message.ConformedDimensions)
  compiledParams.Name = message.Name;
  compiledParams.PendingMerge = false;
  compiledParams.AddedDate = new Date().toJSON();
  compiledParams.SourceSystems = queryProps.SourceSystems ? queryProps.SourceSystems : undefined;
  compiledParams.SourceSystemPriorities = queryProps.SourceSystemPriorities ? queryProps.SourceSystemPriorities : undefined;

  if(message.SourceSystem)
    compiledParams["SourceSystemProps_"+message.SourceSystem] = Object.keys(queryProps.Properties)

  query.params({nodeParams: compiledParams, newUuid: bot.genUuid()});

  return query;
}

// Check before merging. This is for priority checking.
function checkTarget(message) {
  // If we don't have a source system or a priority just go for it.
  if(!message.SourceSystem || !message.Priority) return Promise.resolve({});
  
  var retVal = { // If we don't encounter a node to merge with, this is our initial priority info.
    SourceSystems: [message.SourceSystem],
    SourceSystemPriorities: [message.Priority],
    Properties: message.Properties
  }

  var query = new Query();
  var objectStr = buildObjectStr(message.ConformedDimensions);
  if(objectStr === "{}") return Promise.resolve({});; // Don't run the query if our conformedDimensions is too small. (Should be caught in the schema. This is just paranoia.)
  query.match("(node:Card:"+message.NodeType+" "+objectStr+")")
  query.return("node")

  return bot.query(query.compile(), query.params()).then((result) => {
    if(result.records.length < 1) return retVal;

    var SourceSystems = result.records[0].get('node').properties.SourceSystems;
    var SourceSystemPriorities = result.records[0].get('node').properties.SourceSystemPriorities;

    if(!SourceSystems || !SourceSystemPriorities || SourceSystemPriorities.length !== SourceSystems.length) return retVal;

    // If this source system is already in the list, find it. Add our system if it doesn't exist.
    var existingSourceSystemIdx = SourceSystems.findIndex((itm) => {return itm === message.SourceSystem})
    if(existingSourceSystemIdx !== -1) {
      SourceSystemPriorities[existingSourceSystemIdx] = message.Priority;
    }
    else {
      SourceSystems.push(message.SourceSystem)
      SourceSystemPriorities.push(message.Priority)
    }

    // Figure out properties. Don't update anything that was updated by a higher priority system.
    SourceSystems.forEach((systemName,idx) => {
      var systemPriority = SourceSystemPriorities[idx];
      if(systemPriority <= message.Priority) return; // If we're higher priority, don't filter any props.

      var systemProps = result.records[0].get('node').properties["SourceSystemProps_"+systemName]
      systemProps.forEach((prop) => {
        delete retVal.Properties[prop];
      })
    })

    retVal.SourceSystems = SourceSystems;
    retVal.SourceSystemPriorities = SourceSystemPriorities;
    return retVal;
  });
}

function handleMessage(message) {
  bot.changeState({state: "working"})
  return checkTarget(message).then((queryProps) => {
    var query = getMergeQuery(message, queryProps);
    if(!query) return Promise.reject("Bad query from message.");
  
    return bot.query(query.compile(),query.params()).then(function(result) {
      bot.logger.info("Success for",message.NodeType,"message:",message.Name)
      bot.changeState({state: "idle"}) //TODO: Maybe this is a little premature. Might result in a 'false idle' state.
      return true;
    })
  }).catch(function(err) {
    bot.logger.error("Failure for",message.NodeType,"message:",message.Name);
    bot.logger.error(err.toString());
    bot.changeState({state: "failed",message: err.toString()}) //TODO: We log and recover from these errors. Maybe don't set to an error state.
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