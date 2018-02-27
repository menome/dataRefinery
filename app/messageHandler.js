/*
 * Copyright (C) 2017 Menome Technologies Inc.
 *
 * Handles parsed/verified messages for DB updates.
 */
var bot = require('@menome/botframework')
var Query = require('decypher').Query;
var util = require('util');

/* 
 * This is an ephemeral list of the indices we know are in the DB right now.
 * For fast merges we need to make sure that conformed dimensions have indices on them.
 * But we don't want to keep track of indices via excessive state or config or anything complex like that.
 * So instead, we just make sure that an index exists on each conformed dimension by querying the DB and
 * adding it when we get the message.
 * After that, we add it to this list, and never add it again as long as it's in this list.
 * This list gets blown away every time the app restarts, so there will be a few redundant checks. 
 * Shouldn't really be a big performance hit, as we'll only check each index once per mass import.
 */
var addedIndices = []

// This is like JSON.stringify, except property keys are printed without quotes around them
// And we only include properties that are primitives.
function buildObjectStr(obj) {
  var paramStrings = [];

  for(var p in obj) {
    if(typeof obj[p] === 'object' || typeof obj[p] === 'function') continue;
    else if(typeof obj[p] == 'string') paramStrings.push(util.format('%s: "%s"',p,obj[p]));
    else paramStrings.push(util.format('%s: %s',p,obj[p]));
  }

  return util.format('{%s}',paramStrings.join(','));
}

function getMergeQuery(message,queryProps) {
  var labelType = message.Label ? message.Label : "Card";
  var query = new Query();
  var objectStr = buildObjectStr(message.ConformedDimensions);
  if(objectStr === "{}") return false; // Don't run the query if our conformedDimensions is too small. (Should be caught in the schema. This is just paranoia.)
  var mergeStmt = util.format("(node:"+labelType+":%s %s)",message.NodeType, objectStr);
  query.merge(mergeStmt);

  query.add("ON CREATE SET node.Uuid = {newUuid}");
  query.set("node += {nodeParams}");

  // Build up another merge/set statement for each connection
  // TODO: Parameters should be subobjects in the main query params. This is not yet possible in neo4j.
  if(Array.isArray(message.Connections)) {
    message.Connections.forEach((itm,idx) => {
      var connLabelType = itm.Label ? itm.Label : "Card";
      var nodeName = "node"+idx;
      var newNodeStmt = util.format("(%s:"+connLabelType+":%s %s)",nodeName,itm.NodeType,buildObjectStr(itm.ConformedDimensions))
      query.merge(newNodeStmt);
      query.add(util.format("ON CREATE SET %s.Uuid = {%s_newUuid}, %s.PendingMerge = true, %s += {%s_nodeParams}",nodeName,nodeName,nodeName,nodeName,nodeName));
      query.merge(util.format("(node)%s-[%s_rel:%s]-%s(%s)",(itm.ForwardRel?"":"<"),nodeName,itm.RelType,(itm.ForwardRel?">":""),nodeName))
      query.set(util.format("%s_rel += {%s_relProps}",nodeName, nodeName))

      var itmParams = Object.assign({},itm.Properties,itm.ConformedDimensions)
      if(!!itm.Name) itmParams.Name = itm.Name;
      query.param(nodeName+"_newUuid", bot.genUuid());
      query.param(nodeName+"_nodeParams", itmParams);
      query.param(nodeName+"_relProps", itm.RelProps ? itm.RelProps : {})
    });
  }

  // Compile our top-level parameters.
  var compiledParams = Object.assign({},queryProps.Properties,message.ConformedDimensions)
  if(!!message.Name) compiledParams.Name = message.Name;
  compiledParams.PendingMerge = false;
  compiledParams.TheLinkAddedDate = new Date().getTime();
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
  var labelType = message.Label ? message.Label : "Card";

  var retVal = { // If we don't encounter a node to merge with, this is our initial priority info.
    SourceSystems: [message.SourceSystem],
    SourceSystemPriorities: [message.Priority],
    Properties: message.Properties
  }

  var query = new Query();
  var objectStr = buildObjectStr(message.ConformedDimensions);
  if(objectStr === "{}") return Promise.resolve({});; // Don't run the query if our conformedDimensions is too small. (Should be caught in the schema. This is just paranoia.)
  query.match("(node:"+labelType+":"+message.NodeType+" "+objectStr+")")
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

// Adds indices for conformed dimensions
// Use composite indices.
function addIndices(message) {
  var indices = Object.keys(message.ConformedDimensions);
  var nodeType = message.NodeType;
  var labelType = message.Label ? message.Label : "Card";

  // Check if we even need this index.
  if(addedIndices.indexOf(indices.join()) !== -1) {
    return Promise.resolve(true);
  }

  return bot.query("CREATE INDEX ON :"+labelType+"("+indices.join(',')+")").then((result) => {
    return bot.query("CREATE INDEX ON :"+message.NodeType+"("+indices.join(',')+")").then((result) => {
      return addedIndices.push(indices.join());
    })
  }).catch((err) => {
    if(err.code === "Neo.ClientError.Schema.ConstraintAlreadyExists")
      return true; // Swallow this. Throws if there's a uniqueness constraint on what we're indexing.
    throw err;
  })
}

function handleMessage(message) {
  bot.changeState({state: "working"})

  // Try adding our indices.
  return addIndices(message).then(() => {
    return checkTarget(message).then((queryProps) => {
      var query = getMergeQuery(message, queryProps);
      if(!query) return Promise.reject("Bad query from message.");
    
      return bot.query(query.compile(),query.params()).then(function(result) {
        bot.logger.info("Success for",message.NodeType,"message:",message.Name)
        bot.changeState({state: "idle"}) //TODO: Maybe this is a little premature. Might result in a 'false idle' state.
        return true;
      })
    })
  }).catch(function(err) {
    bot.logger.error("Failure for",message.NodeType,"message:",message.Name);
    bot.logger.error(err.toString());
    bot.logger.error(err.stack);
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
